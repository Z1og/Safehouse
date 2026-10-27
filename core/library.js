const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parseVdf, stringifyVdf, atomicWrite } = require('./valve');
const { readVpk } = require('./vpk');

function gameAt(candidate) {
  const root = path.resolve(candidate);
  if (fs.existsSync(path.join(root, 'left4dead2', 'gameinfo.txt'))) return root;
  if (path.basename(root).toLowerCase() === 'left4dead2' && fs.existsSync(path.join(root, 'gameinfo.txt'))) return path.dirname(root);
  return null;
}
function discover({ roots = [], registry = true } = {}) {
  const candidates = [...roots], steamRoots = new Set();
  if (registry && process.platform === 'win32') {
    for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
      try {
        const value = execFileSync('reg.exe', ['query', key, '/v', key.startsWith('HKCU') ? 'SteamPath' : 'InstallPath'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
        const match = value.match(/REG_SZ\s+(.+)/); if (match) steamRoots.add(path.resolve(match[1].trim()));
      } catch (error) { if (!error.status && error.code !== 'ENOENT') throw error; }
    }
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) if (base) steamRoots.add(path.join(base, 'Steam'));
  } else if (registry) {
    steamRoots.add(path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support/Steam' : '.steam/steam'));
    steamRoots.add(path.join(os.homedir(), '.local/share/Steam'));
  }
  for (const root of roots) steamRoots.add(path.resolve(root));
  const warnings = [];
  for (const root of [...steamRoots]) {
    const libraries = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(libraries)) {
      try {
        const parsed = parseVdf(fs.readFileSync(libraries, 'utf8'));
        for (const entry of Object.values(parsed.libraryfolders || parsed.LibraryFolders || {})) {
          if (typeof entry === 'object' && entry.path) steamRoots.add(path.resolve(entry.path));
          else if (typeof entry === 'string' && path.isAbsolute(entry)) steamRoots.add(path.resolve(entry));
        }
      } catch (error) { warnings.push(`${libraries}: ${error.message}`); }
    }
  }
  for (const root of steamRoots) {
    const manifest = path.join(root, 'steamapps', 'appmanifest_550.acf');
    if (fs.existsSync(manifest)) {
      try {
        const state = parseVdf(fs.readFileSync(manifest, 'utf8')).AppState;
        if (state?.installdir) candidates.push(path.join(root, 'steamapps', 'common', state.installdir));
      } catch (error) { warnings.push(`${manifest}: ${error.message}`); }
    }
    candidates.push(path.join(root, 'steamapps', 'common', 'Left 4 Dead 2'));
  }
  const uniquePaths = values => [...new Map(values.map(value => [process.platform === 'win32' ? value.toLowerCase() : value, value])).values()];
  const games = uniquePaths(candidates.map(gameAt).filter(Boolean));
  return { games, steamRoots: uniquePaths([...steamRoots].filter(root => fs.existsSync(path.join(root, 'steamapps')))), warnings };
}
function within(file, root) { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); }
class Library {
  constructor({ gameRoot = '', steamRoots = [] } = {}) { this.root = gameRoot; this.steamRoots = steamRoots; this.cache = new Map(); this.items = []; this.warnings = []; }
  configure(gameRoot, steamRoots = this.steamRoots) {
    if (!gameAt(gameRoot)) throw new Error('请选择包含 left4dead2/gameinfo.txt 的游戏目录');
    this.root = gameAt(gameRoot); this.steamRoots = [...steamRoots]; this.cache.clear();
    const steamapps = path.dirname(path.dirname(this.root));
    if (path.basename(steamapps).toLowerCase() === 'steamapps' && !this.steamRoots.some(root => path.relative(root, path.dirname(steamapps)) === '')) this.steamRoots.push(path.dirname(steamapps));
  }
  get addonDir() {
    if (!this.root || !gameAt(this.root)) throw new Error('请先在设置中识别或选择求生之路 2 的安装目录');
    return path.join(this.root, 'left4dead2', 'addons');
  }
  addonList() {
    const file = path.join(path.dirname(this.addonDir), 'addonlist.txt');
    if (!fs.existsSync(file)) return {};
    const parsed = parseVdf(fs.readFileSync(file, 'utf8'));
    const key = Object.keys(parsed).find(key => key.toLowerCase() === 'addonlist');
    if (!key || typeof parsed[key] !== 'object') throw new Error('addonlist.txt 格式无效，未更改任何启用状态');
    return parsed[key];
  }
  scan() {
    this.warnings = [];
    if (!this.root) return { items: [], warnings: [], gameRoot: '', paths: [] };
    const addons = this.addonDir;
    const list = Object.fromEntries(Object.entries(this.addonList()).map(([name, value]) => [name.replace(/\\/g, '/').toLowerCase(), value]));
    const locations = [{ dir: addons, source: 'local', depth: 0 }, { dir: path.join(addons, 'workshop'), source: 'workshop', depth: 0 }, ...this.steamRoots.map(root => ({ dir: path.join(root, 'steamapps', 'workshop', 'content', '550'), source: 'cache', depth: 3 }))];
    const found = [], seen = new Set();
    const walk = (dir, source, depth, workshopId = '') => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) { this.warnings.push(`跳过链接：${file}`); continue; }
        if (entry.isDirectory() && depth > 0) { walk(file, source, depth - 1, /^\d+$/.test(entry.name) ? entry.name : workshopId); continue; }
        if (!entry.isFile() || !/\.vpk$/i.test(entry.name) || /_\d{3}\.vpk$/i.test(entry.name)) continue;
        const real = fs.realpathSync(file), normalized = real.toLowerCase();
        if (seen.has(normalized)) continue; seen.add(normalized);
        const stat = fs.statSync(file), relative = path.relative(addons, file).replace(/\\/g, '/');
        const id = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 20);
        const enabled = source !== 'cache' && list[relative.toLowerCase()] !== '0';
        const managedId = entry.name.match(/^safehouse-workshop-(\d+)(?:-\d+)?\.vpk$/i)?.[1];
        const record = { id, file, filename: entry.name, relative, enabled, source, workshopId: workshopId || managedId || (/^\d+\.vpk$/i.test(entry.name) ? entry.name.slice(0, -4) : ''), updated: stat.mtimeMs, size: stat.size };
        const signature = `${stat.size}:${stat.mtimeMs}`;
        try {
          let cached = this.cache.get(real);
          if (!cached || cached.signature !== signature) { cached = { signature, data: readVpk(file) }; this.cache.set(real, cached); }
          found.push({ ...record, ...cached.data });
        } catch (error) { found.push({ ...record, title: entry.name, author: '无法读取', type: 'mod', entries: [], error: error.message }); }
      }
    };
    for (const location of locations) {
      try { walk(location.dir, location.source, location.depth); }
      catch (error) { this.warnings.push(`${location.dir}: ${error.message}`); }
    }
    const installedWorkshopIds = new Set(found.filter(item => item.source !== 'cache').map(item => item.workshopId).filter(Boolean));
    this.items = found.filter(item => item.source !== 'cache' || !installedWorkshopIds.has(item.workshopId));
    const livePaths = new Set(found.map(item => fs.realpathSync(item.file)));
    for (const file of this.cache.keys()) if (!livePaths.has(file)) this.cache.delete(file);
    return { items: this.items.map(({ entries, ...item }) => ({ ...item, resourceCount: entries.length })), warnings: this.warnings, gameRoot: this.root, paths: locations.map(location => location.dir) };
  }
  selected(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw new Error('请选择要操作的内容');
    this.scan();
    return [...new Set(ids)].map(id => {
      const item = this.items.find(item => item.id === id);
      if (!item) throw new Error('内容已经变化，请刷新后重试');
      if (item.source === 'cache') throw new Error('此内容还在 Steam 缓存中，请等待 Steam 同步到 addons');
      const real = fs.realpathSync(item.file);
      if (!within(real, fs.realpathSync(this.addonDir)) || fs.lstatSync(item.file).isSymbolicLink()) throw new Error('目标文件不在游戏 addons 目录内');
      return item;
    });
  }
  setEnabled(ids, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('启用状态必须是布尔值');
    const selected = this.selected(ids), list = this.addonList();
    for (const item of selected) {
      const key = Object.keys(list).find(name => name.replace(/\\/g, '/').toLowerCase() === item.relative.toLowerCase()) || item.relative.replace(/\//g, '\\');
      list[key] = enabled ? '1' : '0';
    }
    atomicWrite(path.join(path.dirname(this.addonDir), 'addonlist.txt'), stringifyVdf({ AddonList: list }));
    return this.scan();
  }
  async uninstall(ids, trash) {
    const selected = this.selected(ids), removed = [];
    for (const item of selected) {
      if (/_dir\.vpk$/i.test(item.file)) throw new Error('分卷包请在文件夹中处理，避免遗留分卷');
    }
    // Persist each success: Windows trash operations cannot be rolled back as a group.
    for (const item of selected) {
      try { await trash(item.file); removed.push(item.id); }
      catch (error) { throw new Error(`已移除 ${removed.length} 项；${item.filename} 未能移至回收站：${error.message}`); }
    }
    return { removed, ...this.scan() };
  }
  async uninstallWorkshop(workshopId, trash) {
    if (typeof workshopId !== 'string' || !/^\d{1,20}$/.test(workshopId)) throw new Error('无效的创意工坊 ID');
    const matches = this.scan().items.filter(item => item.source !== 'cache' && item.workshopId === workshopId);
    if (!matches.length) return { removed: [], ...this.scan() };
    // selected() revalidates actual paths; only addon copies matching the exact
    // project ID are removed. Steam owns and cleans its external cache.
    return this.uninstall(matches.map(item => item.id), trash);
  }
}
module.exports = { Library, discover, gameAt, within };

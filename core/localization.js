const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { atomicWrite, readJson, stringifyVdf } = require('./valve');
const { readVpk } = require('./vpk');

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
class Localizations {
  constructor({ stateDir, library }) {
    this.library = library;
    fs.mkdirSync(stateDir, { recursive: true });
    this.store = path.join(stateDir, 'localized-mods.json');
    const saved = readJson(this.store, []);
    if (!Array.isArray(saved)) throw new Error('本地化记录格式无效');
    this.records = saved.filter(record => record && typeof record.gameRoot === 'string'
      && /^\d{1,20}$/.test(record.workshopId) && /^safehouse-local-\d{1,20}-[a-f0-9]{24}\.vpk$/.test(record.filename));
  }
  currentRecords() {
    return this.records.filter(record => this.library.root && samePath(record.gameRoot, this.library.root));
  }
  decorate(inventory) {
    const records = new Map(this.currentRecords().map(record => [record.filename.toLowerCase(), record]));
    const localizedWorkshopIds = new Set();
    const items = inventory.items.map(item => {
      const record = item.source === 'local' && !item.error && records.get(item.filename.toLowerCase());
      if (!record) return item;
      localizedWorkshopIds.add(record.workshopId);
      return { ...item, localized: true, originWorkshopId: record.workshopId, localizedAt: record.created, localizationTitle: record.title };
    });
    return { ...inventory, items, localizedWorkshopIds: [...localizedWorkshopIds] };
  }
  retained(workshopId) {
    return this.decorate(this.library.scan()).items.filter(item => item.localized && item.originWorkshopId === workshopId);
  }
  async localize(ids) {
    const selected = this.library.selected(ids);
    if (selected.some(item => !item.workshopId || item.error || /_dir\.vpk$/i.test(item.filename))) throw new Error('请选择已完整安装的工坊 VPK；分卷包暂不支持本地化');
    const projectIds = new Set(selected.map(item => item.workshopId));
    // A workshop project may contain several VPKs. Retain its whole installed set.
    const sources = this.library.items.filter(item => item.source !== 'cache' && projectIds.has(item.workshopId));
    if (sources.some(item => item.error || /_dir\.vpk$/i.test(item.filename))) throw new Error('该工坊项目包含损坏或分卷 VPK，请先修复后再本地化');
    const addons = this.library.addonDir;
    if (!samePath(fs.realpathSync(addons), addons)) throw new Error('addons 目录包含链接，无法本地化');
    // Revalidate every source before any copy, including other files of the project.
    this.library.selected(sources.map(item => item.id));
    const list = this.library.addonList(), nextList = { ...list };
    const stage = await fs.promises.mkdtemp(path.join(addons, '.safehouse-localize-'));
    const published = [], records = [], copies = new Map();
    const previousRecords = this.records;
    let savedRecords = false;
    try {
      for (const [index, item] of sources.entries()) {
        const before = await fs.promises.stat(item.file);
        const staged = path.join(stage, `${index}.vpk`), hash = crypto.createHash('sha256');
        await pipeline(fs.createReadStream(item.file), new Transform({ transform(chunk, _, callback) { hash.update(chunk); callback(null, chunk); } }), fs.createWriteStream(staged, { flags: 'wx' }));
        const after = await fs.promises.stat(item.file);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('工坊文件正在更新，请稍后重试本地化');
        readVpk(staged, { install: true });
        const digest = hash.digest('hex');
        const filename = `safehouse-local-${item.workshopId}-${digest.slice(0, 24)}.vpk`, destination = path.join(addons, filename);
        if (!copies.has(filename)) {
          let exists = false;
          try { const stat = await fs.promises.lstat(destination); exists = true; if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('本地化目标不是普通文件'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          const known = this.currentRecords().find(record => record.filename === filename && record.digest === digest);
          if (exists && !known) throw new Error(`已有同名文件：${filename}；未覆盖任何内容`);
          if (exists) {
            const existingHash = crypto.createHash('sha256');
            for await (const chunk of fs.createReadStream(destination)) existingHash.update(chunk);
            if (existingHash.digest('hex') !== digest) throw new Error('已有本地化副本发生变化，未覆盖，请先检查该副本');
          } else {
            // Link only our completed independent staging copy, never the Steam file.
            await fs.promises.link(staged, destination); published.push(destination);
          }
          records.push(known || { gameRoot: this.library.root, workshopId: item.workshopId, filename, digest, title: item.title, created: Date.now() });
          copies.set(filename, { file: destination, enabled: false, existing: exists });
        }
        copies.get(filename).enabled ||= item.enabled;
        const sourceKey = Object.keys(nextList).find(key => key.replace(/\\/g, '/').toLowerCase() === item.relative.toLowerCase()) || item.relative.replace(/\//g, '\\');
        nextList[sourceKey] = '0';
      }
      for (const [filename, copy] of copies) {
        // Repeated localization retains a user's later enable/disable decision.
        const key = Object.keys(nextList).find(key => key.toLowerCase() === filename.toLowerCase()) || filename;
        if (!copy.existing || nextList[key] === undefined) nextList[key] = copy.enabled ? '1' : '0';
      }
      const merged = this.records.filter(record => !samePath(record.gameRoot, this.library.root) || !copies.has(record.filename));
      this.records = [...merged, ...records];
      atomicWrite(this.store, JSON.stringify(this.records, null, 2)); savedRecords = true;
      atomicWrite(path.join(path.dirname(addons), 'addonlist.txt'), stringifyVdf({ AddonList: nextList }));
      return { created: published.length, retained: copies.size, projectIds: [...projectIds] };
    } catch (error) {
      this.records = previousRecords;
      if (savedRecords) atomicWrite(this.store, JSON.stringify(this.records, null, 2));
      for (const file of published) await fs.promises.rm(file, { force: true });
      throw error;
    } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
  }
}
module.exports = { Localizations };

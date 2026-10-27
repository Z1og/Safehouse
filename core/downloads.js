const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { readVpk } = require('./vpk');
const { atomicWrite, readJson } = require('./valve');

async function unpackZip(file, destination, signal) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, result) => error ? reject(error) : resolve(result)));
  return new Promise((resolve, reject) => {
    let count = 0, bytes = 0, settled = false;
    const files = [], names = new Set();
    const finish = error => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); zip.close(); error ? reject(error) : resolve(files); };
    const abort = () => finish(new Error('已取消安装'));
    signal.addEventListener('abort', abort, { once: true }); zip.on('error', finish);
    zip.on('end', () => finish());
    zip.on('entry', entry => {
      (async () => {
        signal.throwIfAborted();
        const name = entry.fileName.replace(/\\/g, '/'), type = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (++count > 4096 || name.split('/').includes('..') || /^[a-z]:|^\//i.test(name) || type === 0xa000 || entry.generalPurposeBitFlag & 1) throw new Error('ZIP 包含不支持的路径、链接或加密文件');
        bytes += entry.uncompressedSize;
        if (bytes > 4 * 1024 ** 3 || entry.uncompressedSize > 2 * 1024 ** 3) throw new Error('ZIP 解压大小超过限制（总计 4 GiB / 单文件 2 GiB）');
        if (!/\.vpk$/i.test(name)) { zip.readEntry(); return; }
        const filename = path.basename(name);
        if (names.has(filename.toLowerCase())) throw new Error(`ZIP 内存在同名 VPK：${filename}`);
        names.add(filename.toLowerCase());
        const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, stream) => error ? rej(error) : res(stream)));
        const target = path.join(destination, filename);
        await pipeline(stream, fs.createWriteStream(target, { flags: 'wx' }), { signal }); files.push(target); zip.readEntry();
      })().catch(finish);
    });
    if (signal.aborted) abort(); else zip.readEntry();
  });
}
class Downloads {
  constructor({ stateDir, library, changed = () => {}, progress = () => {} }) {
    this.stateDir = stateDir; this.library = library; this.changed = changed; this.progress = progress; this.active = null;
    fs.mkdirSync(stateDir, { recursive: true }); this.store = path.join(stateDir, 'downloads.json');
    this.jobs = readJson(this.store, []);
    for (const job of this.jobs) if (['queued', 'installing', 'validating'].includes(job.status) || job.kind === 'panel' && job.status === 'downloading') { job.status = 'failed'; job.error = job.kind === 'panel' ? '上次下载被中断，请从面板重新获取直链' : '上次安装被中断，可重试'; }
    this.save();
  }
  save(notify = true) { atomicWrite(this.store, JSON.stringify(this.jobs, null, 2)); if (notify) this.changed(); }
  list() { return this.jobs.map(({ input, inputs, ...job }) => ({ ...job, filename: input ? path.basename(input) : '' })); }
  enqueue(files) {
    if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error('每次可导入 1–100 个 VPK / ZIP 文件');
    const addonDir = this.library.addonDir;
    const validated = files.map(file => {
      if (typeof file !== 'string' || !/\.(vpk|zip)$/i.test(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('只支持普通 VPK / ZIP 文件');
      if (fs.statSync(file).size > 2 * 1024 ** 3) throw new Error('单个文件不能超过 2 GiB');
      if (this.jobs.some(job => job.input === file && ['queued', 'installing', 'validating'].includes(job.status))) throw new Error('文件已在安装队列中');
      return file;
    });
    for (const input of [...new Set(validated)]) this.jobs.unshift({ id: crypto.randomUUID(), kind: 'import', title: path.basename(input), input, addonDir, status: 'queued', created: Date.now(), bytes: 0, total: fs.statSync(input).size });
    this.save(); this.pump(); return this.list();
  }
  trackWorkshop(id, title) {
    const existing = this.jobs.find(job => job.kind === 'workshop' && job.workshopId === id && ['steam', 'downloading', 'queued', 'validating', 'installing'].includes(job.status));
    if (!existing) this.jobs.unshift({ id: crypto.randomUUID(), kind: 'workshop', workshopId: id, title, status: 'steam', created: Date.now(), bytes: 0, total: null });
    this.save(); return this.list();
  }
  updateWorkshop(id, update) {
    const job = this.jobs.find(job => job.kind === 'workshop' && job.workshopId === id && !['cancelled'].includes(job.status));
    if (!job) return;
    const changed = Object.entries(update).filter(([key, value]) => job[key] !== value);
    if (!changed.length) return;
    Object.assign(job, update);
    const progressOnly = changed.every(([key]) => key === 'bytes' || key === 'total');
    this.save(!progressOnly);
    if (progressOnly) this.progress(this.list());
  }
  cancelWorkshop(id) {
    for (const job of this.jobs.filter(job => job.kind === 'workshop' && job.workshopId === id)) { job.status = 'cancelled'; job.error = ''; }
    this.save(); return this.list();
  }
  async stopWorkshop(id) {
    // Cancel queued copies before aborting the active copy: pump() must not
    // start another job for this project while we wait for stream rollback.
    const active = this.active && this.jobs.find(job => job.id === this.active.id && job.kind === 'workshop' && job.workshopId === id);
    this.cancelWorkshop(id);
    if (active) {
      this.active.controller.abort();
      while (this.active?.id === active.id) await new Promise(resolve => setTimeout(resolve, 25));
      this.cancelWorkshop(id);
    }
  }
  installWorkshop(id, source) {
    const job = this.jobs.find(job => job.kind === 'workshop' && job.workshopId === id && ['steam', 'downloading'].includes(job.status));
    if (!job) return;
    try {
      const stat = fs.statSync(source);
      const files = stat.isFile() ? [source] : fs.readdirSync(source, { withFileTypes: true }).filter(entry => entry.isFile() && /\.vpk$/i.test(entry.name)).map(entry => path.join(source, entry.name));
      if (!files.length || files.length > 100) throw new Error('下载内容未包含可安装的 VPK');
      for (const file of files) { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('下载目录包含文件链接'); readVpk(file, { install: true }); }
      Object.assign(job, { input: files[0], inputs: files, addonDir: this.library.addonDir, status: 'queued', error: '', bytes: 0, total: files.reduce((sum, file) => sum + fs.statSync(file).size, 0) });
      this.save(); this.pump();
    } catch (error) { job.status = 'failed'; job.error = error.message; this.save(); }
  }
  syncWorkshop(items) {
    let changed = false;
    for (const job of this.jobs.filter(job => job.status === 'steam')) {
      const item = items.find(item => item.workshopId === job.workshopId && item.source !== 'cache' && !item.error);
      if (item) { Object.assign(job, { status: 'completed', bytes: item.size, total: item.size, completed: Date.now() }); changed = true; }
    }
    if (changed) this.save();
  }
  cancel(id) {
    const job = this.jobs.find(job => job.id === id);
    if (!job) throw new Error('任务不存在');
    if (job.kind === 'workshop') throw new Error('请使用「取消订阅」停止此工坊任务');
    if (this.active?.id === id) this.active.controller.abort();
    else if (job.status === 'queued') { job.status = 'cancelled'; this.save(); }
    return this.list();
  }
  retry(id) {
    const job = this.jobs.find(job => job.id === id);
    if (!job || job.kind !== 'import' || !['failed', 'cancelled'].includes(job.status)) throw new Error('此任务不能重试');
    if (!fs.existsSync(job.input)) throw new Error('原始文件已不存在，请重新导入');
    job.status = 'queued'; job.error = ''; job.bytes = 0; this.save(); this.pump(); return this.list();
  }
  remove(id) {
    const index = this.jobs.findIndex(job => job.id === id);
    if (index < 0) throw new Error('任务不存在');
    if (this.active?.id === id || !['failed', 'cancelled'].includes(this.jobs[index].status)) throw new Error('仅支持删除已失败或已取消的任务');
    this.jobs.splice(index, 1); this.save(); return this.list();
  }
  clear() { this.jobs = this.jobs.filter(job => !['completed', 'downloaded', 'failed', 'cancelled'].includes(job.status)); this.save(); return this.list(); }
  async pump() {
    if (this.active) return;
    const job = [...this.jobs].reverse().find(job => job.status === 'queued');
    if (!job) return;
    const controller = new AbortController(); this.active = { id: job.id, controller };
    const { signal } = controller, published = [];
    let stage;
    try {
      if (job.addonDir !== this.library.addonDir) throw new Error('游戏目录已变化，请重新导入');
      fs.mkdirSync(job.addonDir, { recursive: true });
      if (fs.realpathSync(job.addonDir).toLowerCase() !== path.resolve(job.addonDir).toLowerCase()) throw new Error('addons 目录包含链接，无法安装');
      stage = fs.mkdtempSync(path.join(job.addonDir, '.safehouse-'));
      job.status = 'validating'; this.save();
      const files = job.inputs || (/\.zip$/i.test(job.input) ? await unpackZip(job.input, stage, signal) : [job.input]);
      const outputName = file => job.kind === 'workshop' ? `safehouse-workshop-${job.workshopId}${files.length > 1 ? `-${files.indexOf(file) + 1}` : ''}.vpk` : path.basename(file);
      if (!files.length) throw new Error('ZIP 中没有找到 VPK');
      const existing = new Set(fs.readdirSync(job.addonDir).map(name => name.toLowerCase()));
      if (job.kind === 'workshop' && files.every(file => {
        const target = path.join(job.addonDir, outputName(file));
        if (!fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink() || fs.statSync(file).size !== fs.statSync(target).size) return false;
        const digest = filePath => { const hash = crypto.createHash('sha256'), descriptor = fs.openSync(filePath, 'r'), buffer = Buffer.alloc(1024 * 1024); try { let count; while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); return hash.digest('hex'); } finally { fs.closeSync(descriptor); } };
        return digest(file) === digest(target);
      })) { job.status = 'completed'; job.completed = Date.now(); job.files = files.map(outputName); job.bytes = job.total; return; }
      for (const file of files) {
        signal.throwIfAborted(); readVpk(file, { install: true });
        const name = outputName(file);
        if (existing.has(name.toLowerCase())) throw new Error(`已有同名文件：${name}；未覆盖任何内容`);
        existing.add(name.toLowerCase());
      }
      job.status = 'installing'; job.bytes = 0; job.total = files.reduce((sum, file) => sum + fs.statSync(file).size, 0); this.save();
      let lastUpdate = 0;
      for (const file of files) {
        signal.throwIfAborted();
        const staged = path.dirname(file) === stage ? file : path.join(stage, outputName(file));
        if (staged !== file) {
          const source = fs.createReadStream(file);
          source.on('data', chunk => { job.bytes += chunk.length; if (Date.now() - lastUpdate > 200) { lastUpdate = Date.now(); this.progress(this.list()); } });
          await pipeline(source, fs.createWriteStream(staged, { flags: 'wx' }), { signal });
        } else job.bytes += fs.statSync(file).size;
        signal.throwIfAborted();
        const destination = path.join(job.addonDir, outputName(file));
        fs.linkSync(staged, destination); published.push(destination);
      }
      job.status = 'completed'; job.completed = Date.now(); job.files = published.map(file => path.basename(file)); job.bytes = job.total;
    } catch (error) {
      for (const file of published) fs.rmSync(file, { force: true });
      job.status = signal.aborted ? 'cancelled' : 'failed'; job.error = signal.aborted ? '已取消安装' : error.message;
    } finally {
      if (stage) fs.rmSync(stage, { recursive: true, force: true });
      this.active = null; this.save(); this.pump();
    }
  }
}
module.exports = { Downloads, unpackZip };

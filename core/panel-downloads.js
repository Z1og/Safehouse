const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readVpk } = require('./vpk');
const { sameOrigin } = require('./console');
const LIMIT = 2 * 1024 ** 3;
const fail = message => Object.assign(new Error(message), { safe: true });
function filename(value) {
  if (typeof value !== 'string' || value.length > 240 || /[\\/\x00-\x1f]/.test(value)) throw fail('下载文件名无效');
  const name = value.replace(/[<>:"|?*]/g, '-').trim().replace(/[. ]+$/, '');
  if (!/\.(vpk|zip)$/i.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)) throw fail('只接收 VPK / ZIP 地图与模组文件');
  return name;
}
function isProviderUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && /(^|\.)(baidupcs\.com|pcs\.baidu\.com)$/i.test(url.hostname); } catch { return false; }
}
function downloadUrl(value, panel) {
  let url;
  try { if (typeof value !== 'string' || value.length > 16384) throw 0; url = new URL(value); } catch { throw fail('直连下载地址无效'); }
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (!isProviderUrl(value) && !sameOrigin(value, panel))) throw fail('只接受当前面板或百度直连文件地址');
  return url.href;
}
function signature(buffer, name) {
  return /\.vpk$/i.test(name) ? buffer.subarray(0, 4).equals(Buffer.from([0x34, 0x12, 0xaa, 0x55])) : buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}
class PanelDownloads {
  constructor({ directory, downloads, fetch, idleTimeout = 60000 }) {
    this.directory = path.resolve(directory); this.downloads = downloads; this.fetch = fetch; this.idleTimeout = idleTimeout; this.active = new Map();
    fs.mkdirSync(this.directory, { recursive: true });
    for (const job of downloads.jobs.filter(value => value.kind === 'panel' && /^[\da-f-]{36}$/i.test(value.id))) fs.rmSync(this.partial(job.id), { force: true });
  }
  isProviderUrl(value) { return isProviderUrl(value); }
  partial(id) { return path.join(this.directory, `.safehouse-${id}.part`); }
  start(value, panel) {
    const name = filename(value.name), url = downloadUrl(value.url, panel), size = value.size;
    if (!Number.isSafeInteger(size) || size < 4 || size > LIMIT) throw fail('地图大小无效或超过 2 GiB 限制');
    if (this.active.size >= 2) throw fail('已有两项直连下载，请完成或取消后再试');
    if ([...this.active.values()].some(value => value.url === url)) throw fail('该文件已在客户端下载中');
    const id = crypto.randomUUID(), ext = path.extname(name), stem = name.slice(0, -ext.length);
    let file = path.join(this.directory, name), suffix = 1;
    while (fs.existsSync(file) || this.downloads.jobs.some(job => job.input === file)) file = path.join(this.directory, `${stem} (${suffix++})${ext}`);
    const job = { id, kind: 'panel', title: name, input: file, sourceHost: new URL(panel).host, status: 'downloading', created: Date.now(), bytes: 0, total: size };
    this.downloads.jobs.unshift(job); this.downloads.save();
    const controller = new AbortController(); this.active.set(id, { controller, url });
    // Reply only after the file signature has been checked. The transfer keeps
    // running in the host after the panel closes its original download dialog.
    return new Promise((resolve, reject) => { this.transfer(job, url, panel, controller, resolve, reject).catch(() => reject(fail('下载记录无法保存，请检查下载目录权限'))); });
  }
  async transfer(job, initial, panel, controller, ready, rejected) {
    const { signal } = controller;
    let handle, reader, response, timer, timedOut = false, lastUpdate = 0, headersReady = false;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.idleTimeout); timer.unref?.(); };
    const partial = this.partial(job.id);
    try {
      let url = initial; touch();
      for (let hop = 0; hop < 6; hop++) {
        signal.throwIfAborted();
        response = await this.fetch(url, { redirect: 'manual', signal, headers: isProviderUrl(url) ? { 'User-Agent': 'pan.baidu.com' } : {} });
        touch(); if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || hop === 5) throw fail('下载重定向过多，请重新获取直链');
        url = downloadUrl(new URL(location, url).href, panel);
      }
      if (response.status !== 200) throw fail(`直链返回 HTTP ${response.status}，请在面板重新获取下载链接`);
      const length = Number(response.headers.get('content-length'));
      if (length > LIMIT || (length > 0 && length !== job.total)) throw fail('返回文件大小与地图记录不一致，请重新获取直链');
      if (!response.body) throw fail('下载没有返回文件内容');
      handle = await fs.promises.open(partial, 'wx'); reader = response.body.getReader();
      let head = Buffer.alloc(0);
      while (true) {
        signal.throwIfAborted(); const { done, value } = await reader.read(); touch(); if (done) break;
        const chunk = Buffer.from(value); job.bytes += chunk.length;
        if (job.bytes > LIMIT || job.bytes > job.total) throw fail('实际下载大小超出地图记录或 2 GiB 限制');
        if (!headersReady) {
          head = Buffer.concat([head, chunk.subarray(0, 4 - head.length)]);
          if (head.length === 4) {
            if (!signature(head, job.title)) throw fail('直链返回的不是有效 VPK / ZIP，可能是失效链接或错误页面');
            headersReady = true; ready({ id: job.id, native: true });
          }
        }
        let offset = 0; while (offset < chunk.length) { const result = await handle.write(chunk, offset, chunk.length - offset); offset += result.bytesWritten; }
        if (Date.now() - lastUpdate > 200) { lastUpdate = Date.now(); this.downloads.save(false); this.downloads.progress(this.downloads.list()); }
      }
      if (!headersReady || job.bytes !== job.total) throw fail('文件下载不完整，请在面板重新获取直链');
      await handle.close(); handle = null;
      if (/\.vpk$/i.test(job.title)) readVpk(partial, { install: true });
      signal.throwIfAborted(); await fs.promises.link(partial, job.input);
      job.status = 'downloaded'; job.completed = Date.now(); job.error = '';
    } catch (error) {
      job.status = signal.aborted && !timedOut ? 'cancelled' : 'failed';
      job.error = timedOut ? '下载连接超时，请在面板重新获取直链' : signal.aborted ? '已取消直连下载' : error.safe ? error.message : '下载中断或文件校验失败，请在面板重新获取直链';
      rejected(fail(job.error));
    } finally {
      clearTimeout(timer); controller.abort();
      if (reader) await reader.cancel().catch(() => {}); else await response?.body?.cancel().catch(() => {});
      await handle?.close().catch(() => {});
      await fs.promises.rm(partial, { force: true }).catch(() => {});
      this.active.delete(job.id); this.downloads.save();
    }
  }
  cancel(id) {
    const active = this.active.get(id); if (!active) throw fail('此下载已经结束');
    active.controller.abort(); return this.downloads.list();
  }
  file(id) {
    const job = this.downloads.jobs.find(job => job.id === id && job.kind === 'panel');
    if (!job || job.status !== 'downloaded' || path.dirname(job.input) !== this.directory || !fs.existsSync(job.input) || fs.lstatSync(job.input).isSymbolicLink()) throw fail('下载文件不存在或尚未完成');
    return job.input;
  }
  async remove(id, trash) {
    const job = this.downloads.jobs.find(job => job.id === id && job.kind === 'panel');
    if (!job) throw fail('下载记录不存在');
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw fail('下载记录标识无效');
    if (this.active.has(id) || !['failed', 'cancelled'].includes(job.status)) throw fail('仅支持清理已失败或已取消的下载');
    const normal = value => path.resolve(value).toLowerCase();
    if (job.input && this.downloads.jobs.some(other => other.id !== id && other.input && normal(other.input) === normal(job.input) && ['queued', 'validating', 'installing'].includes(other.status))) throw fail('文件正在安装，请完成后再清理');
    if (normal(await fs.promises.realpath(this.directory)) !== normal(this.directory)) throw fail('下载目录包含链接，无法安全清理');
    if (job.input && normal(path.dirname(job.input)) !== normal(this.directory)) throw fail('记录中的文件不在客户端下载目录内');
    const candidates = [this.partial(id), ...(job.input ? [job.input] : [])], files = [];
    for (const file of candidates) {
      try {
        const stat = await fs.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || normal(path.dirname(await fs.promises.realpath(file))) !== normal(this.directory)) throw fail('下载残留不是安全的普通文件，请在文件夹中检查');
        files.push(file);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (files.length && typeof trash !== 'function') throw fail('回收站操作不可用，下载记录已保留');
    for (const file of files) {
      try { await trash(file); }
      catch (error) { throw fail(`文件未能移至回收站，下载记录已保留：${error.message}`); }
    }
    return this.downloads.remove(id);
  }
  install(id) {
    const file = this.file(id), result = this.downloads.enqueue([file]);
    const job = this.downloads.jobs.find(job => job.id === id); job.installQueued = true; this.downloads.save(); return result;
  }
  close() { for (const { controller } of this.active.values()) controller.abort(); }
}
module.exports = { PanelDownloads, filename, isProviderUrl, downloadUrl, signature, LIMIT };

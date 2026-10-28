function releaseInfo(value = {}) {
  const version = typeof value.version === 'string' ? value.version.slice(0, 80) : '';
  const notes = typeof value.releaseNotes === 'string' ? value.releaseNotes : Array.isArray(value.releaseNotes) ? value.releaseNotes.map(item => typeof item.note === 'string' ? item.note : '').join('\n') : '';
  return { latestVersion: version, releaseNotes: notes.slice(0, 16000) };
}
function updateError(error, phase) {
  if (/CHECKSUM|SHA512|INVALID_SIGNATURE|DIGEST/i.test(`${error?.code} ${error?.message}`)) return '安装包校验失败，未执行安装。请重新下载。';
  if (/404|NO_PUBLISHED_VERSIONS|LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND/i.test(`${error?.code} ${error?.message}`)) return '暂未找到可用更新，请稍后重试或打开发布页面。';
  return phase === 'install' ? '无法启动更新安装程序，请打开发布页面下载安装版。' : `${phase === 'download' ? '下载' : '检查'}更新失败，请检查 GitHub 网络连接后重试。`;
}

class Updates {
  constructor({ engine, version, mode = 'portable', changed = () => {}, token = () => new (require('builder-util-runtime').CancellationToken)() }) {
    this.engine = engine; this.changed = changed; this.makeToken = token; this.closed = false;
    this.state = { status: engine ? 'idle' : 'disabled', currentVersion: version, mode, latestVersion: '', releaseNotes: '', progress: 0, transferred: 0, total: 0, message: engine ? '点击检查更新，下载后由你决定何时安装。' : '开发模式不安装更新，请使用正式客户端。', phase: '' };
    if (!engine) return;
    engine.autoDownload = false; engine.autoInstallOnAppQuit = false; engine.allowDowngrade = false; engine.allowPrerelease = false;
    engine.disableDifferentialDownload = true; engine.disableWebInstaller = true; engine.logger = null;
    this.listeners = {
      'update-available': info => { if (this.state.status === 'checking') this.set({ ...releaseInfo(info), status: 'available', message: '发现新版本，可以下载更新。' }); },
      'update-not-available': () => { if (this.state.status === 'checking') this.set({ status: 'latest', latestVersion: '', releaseNotes: '', message: '当前已是最新正式版本。' }); },
      'download-progress': info => {
        if (this.state.status !== 'downloading') return;
        const number = value => Number.isFinite(value) ? Math.max(0, value) : 0;
        this.set({ progress: Math.min(100, number(info.percent)), transferred: number(info.transferred), total: number(info.total), message: '正在下载安装包…' });
      },
      'update-downloaded': info => { if (this.state.status === 'downloading') this.set({ ...releaseInfo(info), status: 'downloaded', progress: 100, message: '安装包已下载并通过校验，可以退出并安装。' }); },
      error: error => { if (['checking', 'downloading', 'installing'].includes(this.state.status)) this.fail(error, this.state.phase); },
    };
    for (const [event, handler] of Object.entries(this.listeners)) engine.on(event, handler);
  }
  snapshot() { return { ...this.state }; }
  set(value) { if (!this.closed) { this.state = { ...this.state, ...value }; this.changed(this.snapshot()); } return this.snapshot(); }
  fail(error, phase) { return this.set({ status: 'error', phase, message: updateError(error, phase) }); }
  check() {
    if (!this.engine || this.checking || ['downloading', 'downloaded', 'installing'].includes(this.state.status)) return this.snapshot();
    this.set({ status: 'checking', phase: 'check', message: '正在检查 GitHub 正式版本…', latestVersion: '', releaseNotes: '', progress: 0 });
    this.checking = Promise.resolve().then(() => this.engine.checkForUpdates()).then(result => {
      if (!result && this.state.status === 'checking') this.set({ status: 'disabled', message: '当前运行方式不支持更新，请使用正式客户端。' });
    }).catch(error => { if (this.state.status === 'checking') this.fail(error, 'check'); }).finally(() => { this.checking = null; });
    return this.snapshot();
  }
  download() {
    if (!this.engine || this.downloading || !['available', 'error'].includes(this.state.status) || !this.state.latestVersion || this.state.status === 'error' && this.state.phase !== 'download') throw new Error('请先检查更新，确认存在新版本后再下载');
    this.cancellation = this.makeToken(); const cancellation = this.cancellation;
    this.set({ status: 'downloading', phase: 'download', progress: 0, transferred: 0, total: 0, message: '正在准备下载更新…' });
    this.downloading = Promise.resolve().then(() => this.engine.downloadUpdate(cancellation)).catch(error => {
      if (!cancellation.cancelled && this.state.status === 'downloading') this.fail(error, 'download');
    }).finally(() => { this.downloading = null; });
    return this.snapshot();
  }
  cancel() {
    if (this.state.status !== 'downloading') return this.snapshot();
    this.set({ status: 'available', phase: '', progress: 0, message: '已取消下载，可稍后重新下载。' }); this.cancellation?.cancel(); return this.snapshot();
  }
  install() {
    if (this.state.status !== 'downloaded') throw new Error('安装包尚未下载并通过校验');
    this.set({ status: 'installing', phase: 'install', message: '正在退出客户端并启动安装程序…' });
    try { this.engine.quitAndInstall(false, true); } catch (error) { this.fail(error, 'install'); }
    return this.snapshot();
  }
  close() { this.closed = true; this.cancellation?.cancel(); }
}
module.exports = { Updates, releaseInfo, updateError };

const DEFAULT_CONSOLE_URL = '';
// Stable across release directories; Chromium stores the panel's own expiring
// cookies and site preferences in Safehouse's permanent per-user profile.
const CONSOLE_PARTITION = 'persist:safehouse-center-console';
const path = require('node:path');
const { isIP } = require('node:net');
function gameConnection(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  const address = value.trim().replace(/^connect\s+/i, '');
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})$/i.exec(address);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return null;
  const host = match[1];
  if (host.startsWith('[')) { if (isIP(host.slice(1, -1)) !== 6) return null; }
  else if (/^[\d.]+$/.test(host)) { if (isIP(host) !== 4) return null; }
  else if (host.length > 253 || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  const endpoint = `${host}:${Number(match[2])}`;
  return { address: endpoint, command: `connect ${endpoint}` };
}
function panelZoom(width, mode = 'auto') {
  if (mode !== 'auto' && ![0.7, 0.8, 0.9, 1, 1.1, 1.25].includes(mode)) throw new Error('面板缩放无效');
  return mode === 'auto' ? Math.max(0.7, Math.min(1, width / 1360)) : mode;
}
function consoleUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('控制台地址无效');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整的 http:// 或 https:// 面板地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('只支持 HTTP / HTTPS 面板地址，请在登录栏输入凭据');
  return url.href;
}
function sameOrigin(value, base) { try { return new URL(value).origin === new URL(base).origin && ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }
function configuredConsoleUrl(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return '';
  return consoleUrl(value);
}
function viewBounds(value, size) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error('控制台布局无效');
  const [width, height] = size, x = Math.max(0, Math.min(width, Math.round(value.x))), y = Math.max(67, Math.min(height, Math.round(value.y)));
  return { x, y, width: Math.max(0, Math.min(width - x, Math.round(value.width))), height: Math.max(0, Math.min(height - y - 32, Math.round(value.height))) };
}

class CenterConsole {
  constructor({ electron, window, url, changed, zoom = 'auto', directDownloads }) {
    this.electron = electron; this.window = window; this.url = configuredConsoleUrl(url); this.changed = changed;
    panelZoom(1360, zoom); this.zoomMode = zoom; this.directDownloads = directDownloads;
    this.state = { status: 'idle', message: '先填写服务器管理面板地址，再连接。', url: this.url };
    this.visible = false; this.attached = false; this.auth = null; this.bounds = null; this.generation = 0;
    this.loginHandler = (event, webContents, details, authInfo, callback) => {
      if (webContents !== this.view?.webContents) return;
      event.preventDefault();
      if (authInfo.isProxy || !sameOrigin(details.url, this.url)) { callback(); return; }
      this.cancelAuth(); this.auth = callback; this.setState('auth', '面板需要身份验证，请输入该服务器面板的账号和密码。');
    };
    electron.app.on('login', this.loginHandler);
    window.once('closed', () => this.destroy());
  }
  snapshot() { return { ...this.state, url: this.url, serverConnection: this.serverConnection || null, zoom: this.zoomMode, zoomFactor: this.bounds ? panelZoom(this.bounds.width, this.zoomMode) : 1 }; }
  isPanelSender(event) { return event.sender === this.view?.webContents && event.senderFrame && event.senderFrame === event.senderFrame.top && sameOrigin(event.senderFrame.url, this.url); }
  updateConnection(event, value) {
    if (!this.isPanelSender(event)) throw new Error('服务器地址来源无效');
    if (this.state.status !== 'ready') return;
    const next = gameConnection(value);
    if (next?.command === this.serverConnection?.command) return;
    this.serverConnection = next; this.changed(this.snapshot());
  }
  copyConnection() {
    if (this.state.status !== 'ready' || !this.serverConnection) throw new Error('当前面板尚未提供有效的游戏连接地址');
    this.electron.clipboard.writeText(this.serverConnection.command); return this.serverConnection.command;
  }
  setZoom(mode) { panelZoom(1360, mode); this.zoomMode = mode; this.applyZoom(); return this.snapshot(); }
  applyZoom() { if (this.view?.webContents.setZoomFactor && this.bounds?.width) this.view.webContents.setZoomFactor(panelZoom(this.bounds.width, this.zoomMode)); }
  async helperRequest(event, value) {
    if (!this.isPanelSender(event)) throw new Error('下载请求来源无效');
    if (!value || !['status', 'download'].includes(value.action)) throw new Error('下载请求无效');
    if (!this.directDownloads) throw new Error('客户端下载尚未就绪');
    if (value.action === 'status') return { version: '1.2.1', native: true };
    return this.directDownloads.start(value, this.url);
  }
  setState(status, message) { if (['ready', 'auth', 'error'].includes(status)) clearTimeout(this.loadTimer); if (status !== 'ready') this.serverConnection = null; this.state = { status, message, url: this.url }; this.present(); this.changed(this.snapshot()); }
  ensureView() {
    if (this.view) return;
    if (!this.panelSession) {
      this.panelSession = this.electron.session.fromPartition(CONSOLE_PARTITION);
      this.panelSession.setPermissionRequestHandler((_, __, callback) => callback(false));
      this.panelSession.setPermissionCheckHandler(() => false);
      this.panelSession.on('will-download', event => event.preventDefault());
      this.cookieChanged = () => { clearTimeout(this.cookieTimer); this.cookieTimer = setTimeout(() => this.flush().catch(() => {}), 150); this.cookieTimer.unref?.(); };
      this.panelSession.cookies?.on('changed', this.cookieChanged);
    }
    const panelSession = this.panelSession;
    this.view = new this.electron.WebContentsView({ webPreferences: { session: panelSession, preload: path.join(__dirname, '../console-preload.js'), nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, navigateOnDragDrop: false, spellcheck: false } });
    const contents = this.view.webContents;
    this.responseStatus = 0;
    contents.setWindowOpenHandler(() => { this.changed({ ...this.snapshot(), notice: '请使用工具栏在浏览器中打开外部链接' }); return { action: 'deny' }; });
    const guard = (event, url) => {
      const destination = typeof url === 'string' ? url : event.url;
      if (!sameOrigin(destination, this.url)) { event.preventDefault(); this.changed({ ...this.snapshot(), notice: '已阻止跳转到其他站点，请在连接栏更换面板地址' }); }
    };
    contents.on('will-navigate', guard); contents.on('will-redirect', guard);
    contents.on('will-frame-navigate', event => {
      // The original helper inserts a cloud iframe after handoff. Native streaming
      // already owns that download; do not start a second copy or navigate it.
      if (!event.isMainFrame && this.directDownloads?.isProviderUrl(event.url)) { event.preventDefault(); return; }
      if (event.url !== 'about:blank') guard(event);
    });
    contents.on('did-start-navigation', (_, __, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) { this.responseStatus = 0; if (!this.auth) this.setState('loading', '正在连接服务器面板…'); }
    });
    contents.on('did-navigate', (_, url, code) => {
      this.responseStatus = code;
      if (sameOrigin(url, this.url) && code >= 400 && !this.auth) this.setState('error', `面板返回 HTTP ${code}，请检查面板访问权限或服务状态。`);
    });
    contents.on('did-finish-load', () => {
      this.applyZoom();
      if (!this.auth && this.responseStatus >= 200 && this.responseStatus < 400 && sameOrigin(contents.getURL(), this.url)) { this.setState('ready', '服务器操作由原面板执行'); contents.send?.('safehouse:refreshPanelConnection'); }
    });
    contents.on('did-fail-load', (_, code, description, url, mainFrame) => {
      if (mainFrame && code !== -3 && sameOrigin(url, this.url)) this.setState('error', `连接失败：${description}（${code}），请检查地址、网络和面板服务后重试。`);
    });
    contents.on('render-process-gone', () => this.setState('error', '面板进程已退出，请重新连接。'));
    this.applyZoom();
  }
  show(bounds) { this.visible = true; this.layout(bounds); if (this.state.status === 'idle' && this.url) this.load(); else this.present(); return this.snapshot(); }
  hide() { this.visible = false; this.present(); return this.snapshot(); }
  layout(bounds) { this.bounds = viewBounds(bounds, this.window.getContentSize()); if (this.view) this.view.setBounds(this.bounds); this.applyZoom(); this.present(); return this.snapshot(); }
  present() {
    if (!this.view || this.window.isDestroyed()) return;
    const show = this.visible && ['loading', 'ready'].includes(this.state.status) && this.bounds?.width > 0 && this.bounds?.height > 0;
    if (show && !this.attached) { this.window.contentView.addChildView(this.view); this.attached = true; }
    if (!show && this.attached) { this.window.contentView.removeChildView(this.view); this.attached = false; }
    if (show) this.view.setBounds(this.bounds);
  }
  load(value = this.url) {
    if (!value) { this.url = ''; this.setState('idle', '先填写服务器管理面板地址，再连接。'); return this.snapshot(); }
    const next = consoleUrl(value), changedOrigin = !sameOrigin(next, this.url), generation = ++this.generation;
    this.cancelAuth();
    if (changedOrigin && this.view) { if (this.attached) this.window.contentView.removeChildView(this.view); this.attached = false; this.view.webContents.removeAllListeners(); this.view.webContents.close(); this.view = null; }
    this.url = next; this.ensureView(); this.setState('loading', '正在连接服务器面板…');
    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => { if (generation === this.generation && !this.auth) { this.view.webContents.stop(); this.setState('error', '连接超时，请检查面板地址、网络和服务状态后重试。'); } }, 25000);
    this.view.webContents.loadURL(this.url).catch(error => { if (generation === this.generation && error.code !== 'ERR_ABORTED' && !this.auth) this.setState('error', `连接失败：${error.code || '网络不可用'}，请检查面板地址后重试。`); });
    return this.snapshot();
  }
  authenticate(username, password) {
    if (!this.auth) throw new Error('当前没有待处理的面板登录请求');
    if (typeof username !== 'string' || typeof password !== 'string' || !username || username.length > 256 || password.length > 1024) throw new Error('账号或密码格式无效');
    const callback = this.auth; this.auth = null; this.setState('loading', '正在验证面板账号…'); callback(username, password); return this.snapshot();
  }
  cancelAuth() { if (this.auth) { const callback = this.auth; this.auth = null; callback(); } }
  async flush() { this.panelSession?.flushStorageData?.(); await this.panelSession?.cookies?.flushStore(); }
  destroy() { this.generation++; clearTimeout(this.loadTimer); clearTimeout(this.cookieTimer); this.panelSession?.cookies?.removeListener('changed', this.cookieChanged); this.electron.app.removeListener('login', this.loginHandler); this.cancelAuth(); if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close(); this.view = null; }
}
module.exports = { CenterConsole, consoleUrl, configuredConsoleUrl, sameOrigin, viewBounds, panelZoom, gameConnection, DEFAULT_CONSOLE_URL, CONSOLE_PARTITION };

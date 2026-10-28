const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicWrite } = require('./valve');

const ENDPOINTS = new Set(['/api/auth/login', '/api/auth/guest']);
function originOf(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('面板地址无效');
  return url.origin;
}
function credentials(value) {
  if (!value || !ENDPOINTS.has(value.endpoint) || typeof value.password !== 'string' || !value.password || value.password.length > 1024) throw new Error('登录信息格式无效');
  const field = value.endpoint === '/api/auth/login' ? 'username' : 'profile';
  if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > 512) throw new Error('登录账号格式无效');
  return { endpoint: value.endpoint, [field]: value[field].trim(), password: value.password };
}

// Only explicitly opted-in logins enter this vault. Both account and origin are
// encrypted using the OS account key; settings and Chromium cookies are separate.
class ConsoleLoginStore {
  constructor({ directory, safeStorage }) {
    this.file = path.join(directory, 'console-logins.json'); this.crypto = safeStorage;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (this.data.version !== 1 || !this.data.entries || Array.isArray(this.data.entries) || typeof this.data.entries !== 'object') throw new Error();
    } catch (error) {
      this.data = { version: 1, entries: {} };
      if (error.code !== 'ENOENT') this.readError = true;
    }
  }
  key(origin) { return createHash('sha256').update(originOf(origin)).digest('hex'); }
  has(origin) { return Boolean(this.data.entries[this.key(origin)]); }
  async available() { return !this.readError && Boolean(await this.crypto?.isAsyncEncryptionAvailable?.().catch(() => false)); }
  async save(origin, value, current = () => true) {
    origin = originOf(origin); value = credentials(value);
    if (!await this.available()) throw new Error('本机加密保存暂不可用，未保存登录信息');
    const ciphertext = (await this.crypto.encryptStringAsync(JSON.stringify({ origin, ...value }))).toString('base64');
    if (!current()) return false;
    const next = { version: 1, entries: { ...this.data.entries, [this.key(origin)]: ciphertext } };
    atomicWrite(this.file, JSON.stringify(next)); this.data = next; return true;
  }
  async get(origin) {
    origin = originOf(origin); const encrypted = this.data.entries[this.key(origin)];
    if (!encrypted) return null;
    if (!await this.available()) throw new Error('本机加密保存暂不可用，请手动登录');
    try {
      if (typeof encrypted !== 'string' || encrypted.length > 16384) throw new Error();
      const { result } = await this.crypto.decryptStringAsync(Buffer.from(encrypted, 'base64'));
      const value = JSON.parse(result);
      if (value.origin !== origin) throw new Error();
      return credentials(value);
    } catch {
      this.forget(origin); throw new Error('保存的登录信息已无法读取，请重新登录并勾选记住登录');
    }
  }
  forget(origin) {
    if (this.readError) throw new Error('登录记录文件无法读取，请检查本机数据目录');
    const key = this.key(origin); if (!this.data.entries[key]) return;
    const entries = { ...this.data.entries }; delete entries[key];
    const next = { version: 1, entries }; atomicWrite(this.file, JSON.stringify(next)); this.data = next;
  }
}

class ConsoleLogin {
  constructor({ store, fetch, signedOut = async () => false, changed = () => {}, now = Date.now }) {
    this.store = store; this.fetch = fetch; this.signedOut = signedOut; this.changed = changed; this.now = now;
    this.epochs = new Map(); this.attempts = new Map(); this.pending = new Map(); this.controllers = new Map();
  }
  async status(url) { const origin = originOf(url); return { remembered: this.store.has(origin), available: await this.store.available() }; }
  forget(url, abort = true) {
    const origin = originOf(url); this.epochs.set(origin, (this.epochs.get(origin) || 0) + 1);
    if (abort) this.controllers.get(origin)?.abort(); this.store.forget(origin); this.changed();
  }
  async request(origin, endpoint, payload, signal) {
    const response = await this.fetch(new URL(endpoint, origin).href, {
      method: payload ? 'POST' : 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', signal,
      headers: { Origin: origin, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (endpoint === '/api/auth/session' && response.status === 401) return false;
    if (!response.ok) { const error = new Error([401, 403].includes(response.status) ? '登录已失效，请使用当前账号密码重新登录' : `面板登录暂不可用（HTTP ${response.status}），请手动重试`); error.status = response.status; throw error; }
    let value;
    try { value = await response.json(); } catch { throw new Error('面板未返回有效登录结果，请使用原页面登录'); }
    if (!value || typeof value.authenticated !== 'boolean') throw new Error('面板未提供兼容的登录接口，请使用原页面登录');
    return value.authenticated;
  }
  async run(origin, action) {
    if (this.pending.has(origin)) return this.pending.get(origin);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    this.controllers.set(origin, controller);
    const epoch = this.epochs.get(origin) || 0, current = () => (this.epochs.get(origin) || 0) === epoch && !controller.signal.aborted;
    const promise = (async () => {
      try { return await action(controller.signal, current); }
      catch (error) { if (controller.signal.aborted) throw new Error('自动登录已取消或连接超时，请手动重试'); throw error; }
      finally { clearTimeout(timer); this.pending.delete(origin); if (this.controllers.get(origin) === controller) this.controllers.delete(origin); }
    })();
    this.pending.set(origin, promise); return promise;
  }
  async login(url, value) {
    const origin = originOf(url), clean = credentials(value);
    if (!await this.store.available()) throw new Error('本机加密保存暂不可用，请取消勾选后使用原页面登录');
    if (this.pending.has(origin)) throw new Error('正在验证登录，请稍后重试');
    this.forget(origin);
    return this.run(origin, async (signal, current) => {
      const { endpoint, ...payload } = clean;
      if (!await this.request(origin, endpoint, payload, signal)) throw new Error('登录未成功，未保存账号信息');
      if (!current()) throw new Error('登录操作已取消');
      if (!await this.request(origin, '/api/auth/session', null, signal)) throw new Error('面板未建立有效登录会话，请重试');
      if (!await this.store.save(origin, clean, current)) throw new Error('登录保存已取消');
      this.attempts.delete(origin); this.changed(); return { restored: true, remembered: true };
    });
  }
  async prepare(url) {
    const origin = originOf(url), status = await this.status(origin);
    if (!status.remembered || !status.available) return { ...status, restored: false };
    // Respect logout performed by an older release as well as this process.
    if (await this.signedOut(origin)) { this.forget(origin); return { ...status, remembered: false, restored: false }; }
    if (this.now() - (this.attempts.get(origin) ?? -Infinity) < 60000) return { ...status, restored: false, message: '自动登录暂未成功，请手动重试；不会连续尝试账号密码' };
    this.attempts.set(origin, this.now());
    return this.run(origin, async (signal, current) => {
      if (await this.request(origin, '/api/auth/session', null, signal)) return { ...status, restored: current() };
      const value = await this.store.get(origin); if (!value || !current()) return { ...status, restored: false };
      const { endpoint, ...payload } = value;
      try {
        const authenticated = await this.request(origin, endpoint, payload, signal);
        if (!authenticated) { this.forget(origin, false); throw new Error('保存的登录已失效，请手动登录'); }
        return { ...status, restored: current() };
      } catch (error) {
        if ([401, 403].includes(error.status)) this.forget(origin, false);
        throw error;
      }
    });
  }
  close() { for (const controller of this.controllers.values()) controller.abort(); }
}
module.exports = { ConsoleLoginStore, ConsoleLogin, originOf, credentials };

const crypto = require('node:crypto');
const { atomicWrite, readJson } = require('./valve');

const BING = 'https://cn.bing.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36';
const languageForBing = language => ({ 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans', zh: 'zh-Hans', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant', 'zh-mo': 'zh-Hant', 'en-us': 'en', 'en-gb': 'en', 'ja-jp': 'ja', 'ko-kr': 'ko', 'ru-ru': 'ru' }[language.toLowerCase()] || language);

// Bound the whole response (including its body), even if a transport ignores abort.
async function bounded(action, milliseconds, parent) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent?.aborted) abort(); else parent?.addEventListener('abort', abort, { once: true });
  let timer, rejectAbort;
  const stop = new Promise((_, reject) => {
    rejectAbort = () => reject(new Error('请求超时或已取消'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
    timer = setTimeout(() => controller.abort(), Math.max(1, milliseconds));
  });
  try { return await Promise.race([stop, Promise.resolve().then(() => { controller.signal.throwIfAborted(); return action(controller.signal); })]); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort); controller.abort(); }
}
function chunks(text) {
  const result = [];
  while (text.length > 1000) {
    let end = Math.max(text.lastIndexOf('\n', 999), text.lastIndexOf(' ', 999));
    end = end >= 500 ? end + 1 : 1000;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(0, end)); text = text.slice(end);
  }
  if (text) result.push(text);
  return result;
}
class Translator {
  constructor({ file, fetch }) {
    this.file = file; this.fetch = fetch;
    const saved = readJson(file, {});
    this.cache = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    this.pending = new Map(); this.failures = new Map(); this.bingToken = null; this.bingPending = null;
  }
  async bingCredentials(signal) {
    if (this.bingToken?.expires > Date.now()) return this.bingToken;
    if (!this.bingPending) {
      this.bingPending = bounded(async child => {
        const response = await this.fetch(BING + '/translator?setlang=zh-hans', { signal: child, headers: { 'User-Agent': USER_AGENT } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const raw = html.match(/params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/);
        const ig = html.match(/\bIG\s*:\s*"([^"]+)"/), iid = html.match(/data-iid="(translator\.[^"]+)"/);
        if (!raw || !ig || !iid) throw new Error('服务验证参数暂不可用');
        const [key, token, ttl] = JSON.parse(raw[1]);
        if (!Number.isFinite(key) || typeof token !== 'string' || !token) throw new Error('服务验证参数无效');
        child.throwIfAborted();
        return this.bingToken = { key, token, ig: ig[1], iid: iid[1], sequence: 0, expires: Date.now() + Math.min(Number(ttl) || 600000, 600000) };
      }, 4000, signal).finally(() => { this.bingPending = null; });
    }
    return this.bingPending;
  }
  async bing(text, language, signal) {
    const credentials = await this.bingCredentials(signal), url = new URL('/ttranslatev3', BING);
    url.search = new URLSearchParams({ isVertical: '1', IG: credentials.ig, IID: `${credentials.iid}.${++credentials.sequence}` }).toString();
    const response = await this.fetch(url.href, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, Referer: BING + '/translator' },
      body: new URLSearchParams({ isVertical: '1', fromLang: 'auto-detect', to: languageForBing(language), text, key: String(credentials.key), token: credentials.token }).toString(),
    });
    if (!response.ok) { if ([400, 401, 403].includes(response.status)) this.bingToken = null; throw new Error(`HTTP ${response.status}`); }
    const data = await response.json(), translated = data[0]?.translations?.[0]?.text;
    if (typeof translated !== 'string' || !translated.trim()) { this.bingToken = null; throw new Error('服务未返回有效译文'); }
    return { text: translated, sourceLanguage: data[0]?.detectedLanguage?.language || 'auto', language, provider: 'Bing' };
  }
  async google(text, language, signal) {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.search = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: language, dt: 't', q: text }).toString();
    const response = await this.fetch(url.href, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(), translated = Array.isArray(data[0]) && data[0].map(part => part[0] || '').join('');
    if (typeof translated !== 'string' || !translated.trim()) throw new Error('服务未返回有效译文');
    return { text: translated, sourceLanguage: data[2] || 'auto', language, provider: 'Google' };
  }
  async chunk(text, language, signal, deadline) {
    const errors = [];
    // Avoid repeatedly waiting on a service already found unavailable on this network.
    const providers = ['bing', 'google'].sort((a, b) => Number((this.failures.get(a)?.until || 0) > Date.now()) - Number((this.failures.get(b)?.until || 0) > Date.now()));
    for (const provider of providers) {
      signal.throwIfAborted();
      const failed = this.failures.get(provider);
      if (failed?.until > Date.now()) { errors.push(`${provider === 'bing' ? '必应' : 'Google'}：${failed.message}`); continue; }
      try {
        const result = await bounded(child => this[provider](text, language, child), Math.min(4500, deadline - Date.now()), signal);
        signal.throwIfAborted(); this.failures.delete(provider); return result;
      } catch (error) {
        signal.throwIfAborted();
        const message = /^HTTP \d+$/.test(error.message) ? error.message : /超时|Timeout|Abort/.test(error.message + error.name) ? '连接超时' : '网络或服务响应异常';
        this.failures.set(provider, { until: Date.now() + 30000, message });
        errors.push(`${provider === 'bing' ? '必应' : 'Google'}：${message}`);
      }
    }
    throw new Error(`翻译暂不可用（${errors.join('；')}），请稍后重试`);
  }
  async translate(text, language, { timeoutMs = 12000, retry = false } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('翻译文本需要在 1–12000 个字符之间');
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(language)) throw new Error('目标语言无效');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('翻译超时设置无效');
    const key = crypto.createHash('sha256').update(`${language}\0${text}`).digest('hex');
    if (typeof this.cache[key]?.text === 'string' && this.cache[key].text.trim()) return this.cache[key];
    if (retry) this.failures.clear();
    const pendingKey = key + ':' + timeoutMs;
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const promise = bounded(async signal => {
      const deadline = Date.now() + timeoutMs, parts = chunks(text), translated = new Array(parts.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(2, parts.length) }, async () => {
        while (next < parts.length) {
          const index = next++, part = await this.chunk(parts[index], language, signal, deadline);
          const whitespace = parts[index].match(/\s+$/u)?.[0] || '';
          translated[index] = { ...part, text: whitespace ? part.text.trimEnd() + whitespace : part.text };
        }
      }));
      signal.throwIfAborted();
      const result = { text: translated.map(part => part.text).join(''), sourceLanguage: translated[0].sourceLanguage, language, provider: [...new Set(translated.map(part => part.provider))].join(' / ') };
      this.cache[key] = result;
      for (const old of Object.keys(this.cache).slice(0, Math.max(0, Object.keys(this.cache).length - 1000))) delete this.cache[old];
      try { atomicWrite(this.file, JSON.stringify(this.cache)); } catch { result.warning = '译文已显示，但缓存未能保存'; }
      return result;
    }, timeoutMs).catch(error => {
      if (/请求超时或已取消/.test(error.message)) throw new Error('翻译超过等待时限，已保留原文，请重试');
      throw error;
    }).finally(() => this.pending.delete(pendingKey));
    this.pending.set(pendingKey, promise); return promise;
  }
}
module.exports = { Translator, chunks, languageForBing };

const { workshopId } = require('./community');
const { resolveFilter } = require('../renderer/workshop-catalog');

function timeout(promise, milliseconds = 25000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Steam 接口请求超时，请检查 Steam 网络后重试')), milliseconds); })]).finally(() => clearTimeout(timer));
}
function itemView(item) {
  return { id: String(item.publishedFileId), title: item.title.trim(), description: item.description.replace(/\[\/?[^\]]+\]/g, ' ').trim(), author: String(item.owner.steamId64), image: /^https:\/\//.test(item.previewUrl || '') ? item.previewUrl : '', tags: item.tags, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedFileId}` };
}
class Workshop {
  constructor({ init = () => require('steamworks.js').init(550), disabled = false } = {}) {
    this.init = init; this.disabled = disabled; this.client = null; this.error = ''; this.attempted = 0; this.pending = new Set();
  }
  connect() {
    if (this.disabled) throw new Error('此测试环境未连接 Steam');
    if (this.client) return this.client;
    if (Date.now() - this.attempted < 5000) throw new Error(this.error);
    this.attempted = Date.now();
    try {
      this.client = this.init();
      if (!this.client.apps.isSubscribedApp(550)) { this.client = null; throw new Error('当前 Steam 账号未拥有求生之路 2'); }
      this.error = ''; return this.client;
    } catch (error) { this.error = `Steam 接口未连接：${error.message}。请打开并登录本机 Steam 后重试。`; throw new Error(this.error); }
  }
  status() {
    try {
      const client = this.connect();
      return { ready: true, error: '', subscribedIds: client.workshop.getSubscribedItems().map(String), account: { steamId: String(client.localplayer.getSteamId().steamId64), name: client.localplayer.getName() } };
    } catch (error) { return { ready: false, error: error.message }; }
  }
  snapshot(value) {
    const id = workshopId(value), client = this.connect(), key = BigInt(id);
    const flags = client.workshop.state(key), progress = client.workshop.downloadInfo(key), install = client.workshop.installInfo(key);
    // L4D2 legacy items can report state=0 until their first download.
    const subscribed = Boolean(flags & 1) || client.workshop.getSubscribedItems().some(item => String(item) === id);
    return { subscribed, flags, downloading: Boolean(flags & 16), pending: Boolean(flags & 32), needsUpdate: Boolean(flags & 8), installed: Boolean(flags & 4) && !Boolean(flags & (8 | 16 | 32)), bytes: Number(progress?.current || 0), total: Number(progress?.total || 0), folder: install?.folder || '', size: Number(install?.sizeOnDisk || 0) };
  }
  async search(query, page, category, subcategory = 'all') {
    const client = this.connect();
    const filter = resolveFilter(category, subcategory);
    const result = await timeout(client.workshop.getAllItems(page, query ? 11 : 3, 0, 0, 550, { requiredTags: filter.tags, matchAnyTag: filter.matchAnyTag, searchText: query, language: 'schinese', includeLongDescription: true }));
    return { items: result.items.filter(Boolean).filter(item => item.consumerAppId === 550 && !item.banned).map(itemView), page, hasMore: page * 50 < result.totalResults };
  }
  async details(value) {
    const id = workshopId(value), client = this.connect();
    const item = await timeout(client.workshop.getItem(BigInt(id), { includeLongDescription: true, language: 'schinese' }));
    if (!item || item.consumerAppId !== 550 || item.banned) throw new Error('项目不可用，或不是求生之路 2 的内容');
    return { ...itemView(item), ...this.snapshot(id) };
  }
  async subscribe(value) {
    const id = workshopId(value);
    if (this.pending.has(id)) throw new Error('此项目正在处理，请稍候');
    this.pending.add(id);
    try {
      const item = await this.details(id), client = this.connect();
      await timeout(client.workshop.subscribe(BigInt(id)));
      const accepted = client.workshop.download(BigInt(id), false);
      return { ...item, subscribed: true, accepted };
    } finally { this.pending.delete(id); }
  }
  async unsubscribe(value) {
    const id = workshopId(value);
    if (this.pending.has(id)) throw new Error('此项目正在处理，请稍候');
    this.pending.add(id);
    try { await timeout(this.connect().workshop.unsubscribe(BigInt(id))); return { id, subscribed: false }; }
    finally { this.pending.delete(id); }
  }
}
module.exports = { Workshop, timeout };

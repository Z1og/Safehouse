const cheerio = require('cheerio');
const { workshopId } = require('./community');

const PAGE_SIZE = 30;
function pageNumber(page) {
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('合集页码无效');
  return page;
}
function publicItem(item) {
  const description = cheerio.load(String(item.description || item.short_description || '').replace(/\[\/?[^\]]+\]/g, ' ')).text();
  return { id: String(item.publishedfileid), title: String(item.title || '未命名项目').trim(), author: String(item.creator || ''), description: description.trim().slice(0, 12000), image: /^https:\/\//.test(item.preview_url || '') ? item.preview_url : '', tags: (item.tags || []).map(tag => tag.tag).filter(tag => typeof tag === 'string'), size: Number(item.file_size) || 0, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}` };
}
function parseParents(html, childId, page) {
  const $ = cheerio.load(html);
  let queries;
  try {
    const data = JSON.parse($('#valve-ssr-data').text()), raw = data.renderContext?.queryData;
    queries = (typeof raw === 'string' ? JSON.parse(raw) : raw)?.queries;
  } catch { /* Report an unrecognized response instead of an empty collection list. */ }
  const query = queries?.find(entry => {
    const key = entry.queryKey?.[1];
    return entry.queryKey?.[0] === 'workshop_browse' && key?.appid === 550 && key.section === 'collections' && key.childpublishedfileid === childId && Number(key.page) === page;
  });
  const data = query?.state?.data;
  if (data?.eresult !== 1 || !Array.isArray(data.results) || Number(data.current_page) !== page || !Number.isInteger(Number(data.total_pages)) || Number(data.total_pages) < 0) throw new Error('Steam 所属合集页面暂时无法读取，请重试');
  const seen = new Set();
  const items = data.results.filter(item => {
    const id = String(item.publishedfileid || '');
    if (!/^\d{1,20}$/.test(id) || seen.has(id) || item.consumer_appid !== 550 || item.file_type !== 2 || item.banned) return false;
    // The browse response includes direct children. Reject unrelated collections
    // even if Steam changes or ignores the reverse-lookup filter.
    if (!Array.isArray(item.children) || !item.children.some(child => String(child.publishedfileid) === childId)) throw new Error('Steam 返回的合集与当前模组不匹配，请重试');
    seen.add(id); return true;
  }).map(item => ({ ...publicItem(item), isCollection: true, memberCount: Number(item.num_children) || item.children.length }));
  const totalPages = Math.min(1000, Number(data.total_pages));
  return { items, page, totalPages, hasMore: page < totalPages, total: Number(data.total_count) || 0 };
}

class Collections {
  constructor({ community, now = Date.now }) { this.community = community; this.now = now; this.cache = new Map(); this.pending = new Map(); }
  async cached(key, action) {
    const entry = this.cache.get(key);
    if (entry && entry.expires > this.now()) return entry.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(action).then(value => {
      this.cache.delete(key); this.cache.set(key, { value, expires: this.now() + 180000 });
      while (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise); return promise;
  }
  async parents(value, page = 1) {
    const id = workshopId(value); pageNumber(page);
    return this.cached(`parents:${id}:${page}`, async () => {
      const url = new URL('https://steamcommunity.com/workshop/browse/');
      url.search = new URLSearchParams({ appid: '550', section: 'collections', childpublishedfileid: id, p: String(page), numperpage: String(PAGE_SIZE), l: 'schinese', browsesort: 'trend' }).toString();
      return { ...parseParents(await this.community.request(url.href, {}, 16 * 1024 ** 2), id, page), childId: id };
    });
  }
  async children(id) {
    return this.cached(`children:${id}`, async () => {
      const body = new URLSearchParams({ collectioncount: '1', 'publishedfileids[0]': id });
      const json = JSON.parse(await this.community.request('https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
      const collection = json.response?.collectiondetails?.[0];
      if (collection?.result !== 1 || String(collection.publishedfileid) !== id || !Array.isArray(collection.children)) throw new Error('合集不可用，可能已被删除、设为私有，或不是合集');
      if (collection.children.length > 10000) throw new Error('合集成员过多，请在官方页面查看');
      const seen = new Set();
      return collection.children.filter(item => {
        const key = String(item.publishedfileid || '');
        if (!/^\d{1,20}$/.test(key) || key === id || seen.has(key)) return false;
        seen.add(key); return true;
      }).sort((a, b) => Number(a.sortorder || 0) - Number(b.sortorder || 0)).map(item => ({ id: String(item.publishedfileid), isCollection: Number(item.filetype) === 2 }));
    });
  }
  async members(value, page = 1) {
    const id = workshopId(value); pageNumber(page);
    return this.cached(`members:${id}:${page}`, async () => {
      const [collection, children] = await Promise.all([this.community.details(id), this.children(id)]);
      const totalPages = Math.ceil(children.length / PAGE_SIZE), selected = children.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      let items = [];
      if (selected.length) {
        const body = new URLSearchParams({ itemcount: String(selected.length) });
        selected.forEach((item, index) => body.append(`publishedfileids[${index}]`, item.id));
        const json = JSON.parse(await this.community.request('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 8 * 1024 ** 2));
        if (!Array.isArray(json.response?.publishedfiledetails)) throw new Error('合集成员详情读取失败，请重试');
        const details = new Map(json.response.publishedfiledetails.map(item => [String(item.publishedfileid), item]));
        items = selected.map(child => {
          const item = details.get(child.id);
          return item?.result === 1 && item.consumer_app_id === 550 && !item.banned
            ? { ...publicItem(item), isCollection: child.isCollection }
            : { ...child, title: `不可用项目 · ${child.id}`, unavailable: true, description: '项目已隐藏、删除或不属于求生之路 2。' };
        });
      }
      return { collection: { ...collection, isCollection: true, memberCount: children.length }, items, page, totalPages, hasMore: page < totalPages, total: children.length };
    });
  }
}
module.exports = { Collections, parseParents, publicItem, PAGE_SIZE };

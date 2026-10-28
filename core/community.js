const { Translator } = require('./translator');
const cheerio = require('cheerio');
const { categories: WORKSHOP_CATEGORIES, resolveFilter } = require('../renderer/workshop-catalog');

function workshopId(value) {
  if (typeof value !== 'string') throw new Error('无效的创意工坊 ID');
  if (/^\d{1,20}$/.test(value)) return value;
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入工坊关键词、数字 ID 或官方项目链接'); }
  const id = url.searchParams.get('id');
  if (url.protocol !== 'https:' || url.hostname !== 'steamcommunity.com' || url.pathname !== '/sharedfiles/filedetails/' || !/^\d{1,20}$/.test(id || '')) throw new Error('只支持 Steam 官方创意工坊项目链接');
  return id;
}
function parseSearch(html) {
  const modern = parseBrowse(html);
  if (modern) return modern.items;
  const $ = cheerio.load(html), items = [], seen = new Set();
  $('a[href*="/sharedfiles/filedetails/"]').each((_, element) => {
    const link = $(element), image = link.find('img').first();
    if (!image.length) return;
    let id; try { id = workshopId(new URL(link.attr('href'), 'https://steamcommunity.com').href); } catch { return; }
    if (seen.has(id)) return;
    const card = link.closest('.workshopItem');
    const title = (card.find('.workshopItemTitle').first().text() || image.attr('alt') || link.attr('title') || '').trim();
    if (!title) return;
    seen.add(id);
    const preview = image.attr('src') || '';
    items.push({ id, title, author: card.find('.workshopItemAuthorName').text().replace(/^by\s*/i, '').trim(), image: /^https:\/\//.test(preview) ? preview : '', description: '', url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` });
  });
  return items.slice(0, 30);
}
function parseBrowse(html) {
  try {
    const $ = cheerio.load(html), data = JSON.parse($('#valve-ssr-data').text());
    const queryData = typeof data.renderContext?.queryData === 'string' ? JSON.parse(data.renderContext.queryData) : data.renderContext?.queryData;
    const query = queryData?.queries?.find(entry => entry.queryKey?.[0] === 'workshop_browse' && entry.queryKey?.[1]?.appid === 550);
    const result = query?.state?.data;
    if (!Array.isArray(result?.results)) return null;
    const items = result.results.filter(item => item.consumer_appid === 550 && /^\d{1,20}$/.test(item.publishedfileid) && !item.banned).map(item => ({ id: item.publishedfileid, title: String(item.title || '').trim(), author: String(item.creator || ''), description: String(item.short_description || ''), image: /^https:\/\//.test(item.preview_url || '') ? item.preview_url : '', tags: (item.tags || []).map(tag => tag.tag), url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}` }));
    const page = Number(result.current_page) || 1, totalPages = Number(result.total_pages);
    return { items, page, hasMore: page < totalPages, ...(Number.isInteger(totalPages) && totalPages >= 0 ? { totalPages } : {}) };
  } catch { return null; }
}
class Community {
  constructor({ session, language = 'zh-CN', workshop }) { this.session = session; this.language = language; this.workshop = workshop; }
  async request(url, options = {}, limit = 5 * 1024 ** 2) {
    const response = await this.session.fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`Steam 请求失败（HTTP ${response.status}）`);
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) throw new Error('社区返回内容过大'); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async search(query = '', page = 1, category = 'all', subcategory = 'all') {
    if (typeof query !== 'string' || query.length > 200) throw new Error('搜索内容过长');
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('页码无效');
    const filter = resolveFilter(category, subcategory);
    if (/^\d{1,20}$|^https:\/\//.test(query)) return { items: [await this.details(workshopId(query))], page: 1, hasMore: false };
    if (this.workshop?.status().ready) {
      try { return await this.workshop.search(query, page, category, subcategory); } catch { /* Public browsing remains available if Steam is offline. */ }
    }
    const url = new URL('https://steamcommunity.com/workshop/browse/');
    const params = new URLSearchParams({ appid: '550', searchtext: query, p: String(page), numperpage: '30', l: 'schinese', browsesort: query ? 'textsearch' : 'trend', section: 'readytouseitems' });
    for (const tag of filter.tags) params.append('requiredtags[]', tag);
    params.set('match_all_tags', filter.matchAnyTag ? '0' : '1');
    url.search = params.toString();
    const html = await this.request(url.href);
    if (/g-recaptcha|id="captcha"/.test(html)) throw new Error('Steam 要求网页验证，请使用「打开 Steam 社区」完成后重试');
    const modern = parseBrowse(html);
    if (modern) return modern;
    const items = parseSearch(html);
    const $ = cheerio.load(html);
    let modernBrowse = false;
    try { const data = JSON.parse($('#valve-ssr-data').text()); modernBrowse = data.route === '/workshop/browse' && data.loaderData.some(entry => JSON.parse(entry).serverQuery?.appid === 550); } catch { /* Legacy page. */ }
    if (!items.length && !modernBrowse && !$('.workshopBrowseItems, .workshopBrowsePaging, .workshopItem, .no_items, .workshopBrowseItemsNoResults, .workshop_empty').length && !/No items|没有找到|未找到|no matching|No matching|您没有订阅|没有订阅/i.test($.text())) throw new Error('Steam 页面暂时无法解析，请稍后重试');
    const pagingLinks = $('a[href*="p="], a.pagelink').map((_, el) => $(el).attr('href')).get();
    const hasMore = pagingLinks.some(href => { try { return Number(new URL(href, url).searchParams.get('p')) > page; } catch { return false; } });
    return { items, page, hasMore };
  }
  async details(value) {
    if (this.workshop?.status().ready) {
      try { return await this.workshop.details(value); } catch { /* Fall back to public metadata. */ }
    }
    const id = workshopId(value), body = new URLSearchParams({ itemcount: '1', 'publishedfileids[0]': id });
    const json = JSON.parse(await this.request('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    const item = json.response?.publishedfiledetails?.[0];
    if (item?.result !== 1 || String(item.publishedfileid) !== id || item.consumer_app_id !== 550) throw new Error('项目不可用，或不是求生之路 2 的内容');
    const $ = cheerio.load(String(item.description || '').replace(/\[\/?[^\]]+\]/g, ' '));
    return { id, title: item.title, description: $.text().trim().slice(0, 12000), author: String(item.creator || ''), image: /^https:\/\//.test(item.preview_url || '') ? item.preview_url : '', size: Number(item.file_size) || 0, tags: (item.tags || []).map(tag => tag.tag), url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` };
  }
}
module.exports = { Community, Translator, parseSearch, parseBrowse, workshopId, WORKSHOP_CATEGORIES };

const path = require('node:path');
const { atomicWrite, readJson } = require('./valve');
const { workshopId } = require('./community');

function identity(value) {
  const id = workshopId(value);
  if (BigInt(id) === 0n) throw new Error('无效的创意工坊 ID');
  return BigInt(id).toString();
}
function snapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('收藏内容无效');
  const id = identity(value.id);
  const text = (field, length) => typeof value[field] === 'string' ? value[field].trim().slice(0, length) : '';
  const title = text('title', 500);
  if (!title) throw new Error('收藏缺少标题');
  let image = '';
  try { const url = new URL(value.image); if (url.protocol === 'https:' && !url.username && !url.password) image = url.href.slice(0, 4096); } catch { /* Preview is optional. */ }
  return { id, title, author: text('author', 200), description: text('description', 12000), image,
    size: Number.isFinite(value.size) && value.size >= 0 ? value.size : 0,
    tags: [...new Set((Array.isArray(value.tags) ? value.tags : []).filter(tag => typeof tag === 'string').map(tag => tag.trim().slice(0, 100)).filter(Boolean))].slice(0, 100),
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` };
}

// Bookmarks own only public metadata. No Steam or game-file operation belongs here.
class Favorites {
  constructor({ stateDir }) {
    this.file = path.join(stateDir, 'favorites.json');
    const saved = readJson(this.file, { version: 1, items: [] });
    if (saved.version !== 1 || !Array.isArray(saved.items)) throw new Error('收藏记录格式无效，请保留 favorites.json 后检查');
    this.items = saved.items.map(item => ({ ...snapshot(item), savedAt: Number(item.savedAt) || 0 }));
  }
  list() { return structuredClone(this.items).sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id)); }
  save(items) { atomicWrite(this.file, JSON.stringify({ version: 1, items }, null, 2)); this.items = items; return this.list(); }
  add(value) {
    const item = snapshot(value), previous = this.items.find(value => value.id === item.id);
    if (!previous && this.items.length >= 5000) throw new Error('最多保存 5000 项收藏，请先整理已有收藏');
    return this.save([...this.items.filter(value => value.id !== item.id), { ...previous, ...item, description: item.description || previous?.description || '', tags: item.tags.length ? item.tags : previous?.tags || [], savedAt: previous?.savedAt || Date.now() }]);
  }
  remove(value) {
    const id = identity(value);
    if (!this.items.some(item => item.id === id)) return this.list();
    return this.save(this.items.filter(item => item.id !== id));
  }
}
module.exports = { Favorites, snapshot };

const api = window.safehouse;
const icons = {
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM9 12l2 2 4-4"/>',
  settings: '<path d="m9 4 1-2h4l1 2 3 2 2 .2 2 3-1 2v3l1 2-2 3-2 .2-3 2-1 2h-4l-1-2-3-2-2-.2-2-3 1-2v-3l-1-2 2-3L6 6z"/><circle cx="12" cy="12" r="3"/>',
  sparkles: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4zM20 2v4m-2-2h4"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  steam: '<circle cx="16" cy="7" r="5"/><circle cx="16" cy="7" r="2"/><circle cx="7" cy="17" r="4"/><path d="m1 13 5 2m4 4 7-7m-8 1 3-6"/>',
  minus: '<path d="M5 12h14"/>', square: '<rect x="5" y="5" width="14" height="14" rx="1"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  play: '<path d="m8 4 12 8-12 8z"/>', check: '<path d="m5 12 4 4L19 6"/>',
  drive: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 14h18m-5 3h.01m-4 0h.01"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zm6-2v16m6-14v16"/>',
  weapon: '<path d="m4 4 16 16m-6-3 3-3M3 8l5-5M5 6l13 13m-3-1 4 3 2-2-3-4"/>',
  survivor: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  sound: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  package: '<path d="m12 2 9 5-9 5-9-5zm-9 5v10l9 5 9-5V7M12 12v10M7.5 4.5l9 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/>',
  translate: '<path d="M3 5h12M9 2v3M5 5c0 6 8 10 8 10M13 5c0 6-8 10-8 10m9 6 4-11 4 11m-6-4h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.package}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); }); }
hydrateIcons();
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const main = document.querySelector('#main');
const labels = { library: '模组管理', workshop: '创意工坊', console: '中心控制台', settings: '偏好设置' };
const { types, groups: categoryGroups, targets: targetCatalog } = window.SafehouseCatalog;
const sources = { local: '本地导入', workshop: 'Steam 工坊', cache: 'Steam 缓存' };
let state, page = 'library', filter = 'all', subfilter = 'all', slotFilter = 'all', repeatedOnly = false, query = '', sort = 'updated', layout = 'grid', selected = new Set(), busy = false;
let workshop = { items: [], query: '', page: 1, category: 'all', subcategory: 'all', hasMore: false, loading: false, error: '', loaded: false, generation: 0, translationError: '' };
let detail, detailRequest = 0, detailTranslated = null, showOriginal = false, toastTimer, pendingRefresh = false;
const uiLanguages = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', de: 'Deutsch', fr: 'Français', ru: 'Русский', es: 'Español', pt: 'Português', th: 'ไทย' };
const workshopCategories = Object.entries(window.SafehouseWorkshopCatalog.categories).filter(([id]) => id !== 'campaign').map(([id, value]) => [id, value.label]);
const activeStatuses = ['queued', 'installing', 'validating', 'steam', 'downloading'];
const jobStatus = { queued: '排队中', validating: '校验内容', installing: '正在安装', steam: '等待 Steam 下载', downloading: '正在下载', completed: '已完成', downloaded: '下载完成', failed: '处理失败', cancelled: '已取消' };
let transfersExpanded = null;
let localSearch = { original: '', queries: [], warning: '' }, localSearchTimer, localSearchGeneration = 0;
let consoleState = { status: 'idle', message: '连接你的服务器管理面板', url: '' }, consoleObserver, consoleWide = false, consoleAddressExpanded = false;
function searchNote(plan) {
  if (!plan?.original) return '';
  const extra = plan.queries.filter(value => value.toLowerCase() !== plan.original.toLowerCase());
  return `<div class="search-note">${icon('translate')}<span>${extra.length ? `双语匹配：${escape(plan.original)} · ${extra.map(escape).join(' · ')}` : '已启用中英文自适应搜索'}${plan.warning ? ` · ${escape(plan.warning)}` : ''}</span></div>`;
}
function updateLocalSearch(value) {
  query = value.slice(0, 200); const generation = ++localSearchGeneration; clearTimeout(localSearchTimer);
  localSearch = { original: query.trim(), queries: window.SafehouseSearch.aliases(query), warning: '' }; renderLibraryContent();
  if (!query.trim() || !api?.searchPlan) return;
  localSearchTimer = setTimeout(async () => {
    try { const result = await call('searchPlan', query); if (generation === localSearchGeneration) { localSearch = result; if (page === 'library') renderLibraryContent(); } }
    catch (error) { if (generation === localSearchGeneration) { localSearch.warning = error.message; if (page === 'library') renderLibraryContent(); } }
  }, 350);
}
function bytes(value) { if (!value) return '0 B'; const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`; }
function toast(text) { const element = document.querySelector('#toast'); element.textContent = text; element.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 5500); }
async function call(method, ...args) { if (!api) throw new Error('请使用 Safehouse 桌面客户端打开'); const result = await api[method](...args); if (!result.ok) throw new Error(result.error); return result.data; }
async function task(action) { if (busy) return; busy = true; try { await action(); } catch (error) { toast(error.message); } finally { busy = false; } }
async function savePreferences(value) {
  state.settings = await call('settings', value); workshop.loaded = false; theme();
}
function theme() { const mode = state?.settings.theme || 'system'; document.documentElement.dataset.theme = mode === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : mode; }
function button(text, action, name = '', className = '', attributes = '') { return `<button class="button ${className}" data-action="${action}" ${attributes}>${name ? icon(name) : ''}${text}</button>`; }
function empty(name, title, description, action = '') { return `<div class="empty"><div class="empty-symbol">${icon(name)}</div><h3>${title}</h3><p>${description}</p>${action}</div>`; }
function heading(title, description, actions = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`; }
function updateShell() {
  renderServerConnection();
  const installed = state.items.filter(item => item.source !== 'cache');
  document.querySelector('#library-count').textContent = installed.length;
  document.querySelector('#game-status').innerHTML = `<i class="status-dot ${state.gameRoot ? 'ready' : ''}"></i>${state.gameRoot ? `已连接 · ${escape(state.gameRoot)}` : '未找到游戏 · 请在偏好设置中选择安装目录'}`;
  document.querySelector('#game-status').title = state.gameRoot;
  document.querySelector('#version').textContent = `v${state.version}`;
  const account = state.steam?.account;
  document.querySelector('#account-name').textContent = account?.name || 'Steam 本地状态';
  document.querySelector('#account-status').textContent = account ? (state.steam.running ? 'Steam 正在运行 · 本机已识别' : 'Steam 未运行 · 已读取本地账号') : '未找到本地 Steam 账号';
  document.querySelector('#account .avatar').innerHTML = icon('steam');
  theme();
}
function renderServerConnection() {
  const card = document.querySelector('#server-connection'), command = document.querySelector('#server-connection-command'), hint = document.querySelector('#server-connection-hint');
  if (!card || !command || !hint) return;
  const connection = consoleState.status === 'ready' ? consoleState.serverConnection : null;
  card.dataset.status = connection ? 'ready' : 'unavailable';
  command.textContent = connection?.command || '暂未获取服务器地址';
  command.title = connection ? '点击复制到游戏控制台' : '';
  card.querySelectorAll('button').forEach(element => { element.disabled = !connection; });
  hint.textContent = connection ? '点击文本或图标即可复制' : consoleState.status === 'idle' ? '打开控制台后自动读取' : consoleState.status === 'loading' ? '正在读取当前面板…' : consoleState.status === 'error' ? '面板连接失败，旧地址已清除' : consoleState.status === 'auth' ? '登录面板后读取服务器地址' : '当前面板未提供游戏连接地址';
}
function render() {
  document.querySelectorAll('[data-page]').forEach(element => element.classList.toggle('active', element.dataset.page === page));
  document.querySelector('#breadcrumb').textContent = labels[page];
  if (!state) return;
  updateShell();
  main.classList.toggle('console-page', page === 'console');
  document.body.classList.toggle('console-wide', page === 'console' && consoleWide);
  if (page !== 'console') { consoleObserver?.disconnect(); if (api?.consoleHide) call('consoleHide').catch(() => {}); }
  ({ library: renderLibrary, workshop: renderWorkshop, console: renderConsole, settings: renderSettings })[page]();
}
async function refresh(renderPage = true) {
  if (pendingRefresh) return; pendingRefresh = true;
  try {
    const previousSteamId = state?.steam?.account?.steamId;
    state = await call('state');
    const steamChanged = previousSteamId !== state.steam?.account?.steamId;
    selected = new Set([...selected].filter(id => state.items.some(item => item.id === id)));
    if (steamChanged) { workshop.generation++; workshop.items = []; workshop.loaded = false; workshop.loading = false; workshop.error = ''; }
    updateShell();
    if (renderPage || steamChanged) render();
    else { renderTransfers(); if (page === 'workshop') renderWorkshopContent(); }
    if (detail) renderDetail();
    if (steamChanged && page === 'workshop') loadWorkshop();
  }
  finally { pendingRefresh = false; }
}
const itemTargets = item => item.targets || [];
function inCategory(item, value = filter) {
  return value === 'all' || value === 'disabled' && !item.enabled && item.source !== 'cache' || (item.categories || [item.type]).includes(value);
}
function targetStatistics() {
  const counts = new Map();
  for (const item of state.items) for (const target of itemTargets(item)) {
    if (!counts.has(target.id)) counts.set(target.id, { total: 0, installed: 0, enabled: 0 });
    const count = counts.get(target.id); count.total++;
    if (item.source !== 'cache') { count.installed++; if (item.enabled) count.enabled++; }
  }
  return counts;
}
const replacementSlot = target => target && ['survivor', 'weapon', 'infected', 'item'].includes(target.type) && !target.id.endsWith(':unknown');
function filteredItems() {
  const terms = localSearch.original === query.trim() ? localSearch.queries : window.SafehouseSearch.aliases(query), counts = targetStatistics();
  return state.items.filter(item => inCategory(item)
    && (subfilter === 'all' || itemTargets(item).some(target => target.type === filter && target.group === subfilter))
    && (slotFilter === 'all' || itemTargets(item).some(target => target.id === slotFilter))
    && (!repeatedOnly || itemTargets(item).some(target => replacementSlot(target) && counts.get(target.id)?.enabled > 1
      && (slotFilter === 'all' || target.id === slotFilter)
      && (['all', 'disabled'].includes(filter) || target.type === filter)
      && (subfilter === 'all' || target.group === subfilter)))
    && window.SafehouseSearch.matches(`${item.title} ${item.filename} ${item.author} ${itemTargets(item).map(target => `${target.label} ${categoryGroups[target.type]?.[target.group] || ''}`).join(' ')}`, terms)
  ).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh') : sort === 'slot' ? (itemTargets(a)[0]?.label || '').localeCompare(itemTargets(b)[0]?.label || '', 'zh') || a.title.localeCompare(b.title, 'zh') : sort === 'size' ? b.size - a.size : b.updated - a.updated);
}
function renderTaxonomy() {
  const container = document.querySelector('#library-taxonomy'); if (!container) return;
  const counts = targetStatistics(), scoped = state.items.filter(item => inCategory(item));
  const singlePeople = ['survivor', 'infected'].includes(filter);
  const countItems = test => scoped.filter(item => itemTargets(item).some(test)).length;
  const chip = (label, count, attributes, active) => `<button class="chip ${active ? 'active' : ''}" ${attributes}>${escape(label)}<span class="filter-count">${count}</span></button>`;
  const options = targetCatalog.filter(target => counts.get(target.id)?.total && (['all', 'disabled'].includes(filter) || target.type === filter) && (subfilter === 'all' || target.group === subfilter));
  const scopedIds = new Set(scoped.flatMap(item => itemTargets(item)).filter(target => (['all', 'disabled'].includes(filter) || target.type === filter) && (subfilter === 'all' || target.group === subfilter) && (slotFilter === 'all' || target.id === slotFilter)).map(target => target.id));
  const repeated = [...counts].filter(([id, count]) => scopedIds.has(id) && count.enabled > 1 && replacementSlot(targetCatalog.find(target => target.id === id))).length;
  const chips = singlePeople
    ? chip('全部角色', scoped.length, 'data-slot="all"', slotFilter === 'all') + targetCatalog.filter(target => target.type === filter && (!target.id.endsWith(':unknown') || counts.get(target.id)?.total)).map(target => chip(target.label, countItems(value => value.id === target.id), `data-slot="${target.id}"`, slotFilter === target.id)).join('')
    : categoryGroups[filter] ? chip('全部类型', scoped.length, 'data-subfilter="all"', subfilter === 'all') + Object.entries(categoryGroups[filter]).map(([id, label]) => chip(label, countItems(target => target.type === filter && target.group === id), `data-subfilter="${id}"`, subfilter === id)).join('') : '';
  const chosen = targetCatalog.find(target => target.id === slotFilter), chosenCount = counts.get(slotFilter);
  container.innerHTML = `<section class="taxonomy-panel" aria-label="内容二级分类"><div class="taxonomy-heading"><b>${singlePeople ? '具体替换角色' : '细分类型与替换目标'}</b><span>${chosen ? `${escape(chosen.label)} · 已安装 ${chosenCount?.installed || 0} · 已启用 ${chosenCount?.enabled || 0}` : '依据 VPK 实际资源识别 · 同一包可覆盖多个目标'}</span></div>${chips ? `<div class="filters subfilters">${chips}</div>` : ''}<div class="target-tools">${!singlePeople ? `<label class="slot-select-label">具体替换目标<select id="library-slot" aria-label="具体替换目标"><option value="all">全部目标</option>${Object.keys(types).map(type => { const targets = options.filter(target => target.type === type); return targets.length ? `<optgroup label="${types[type]}">${targets.map(target => `<option value="${target.id}" ${slotFilter === target.id ? 'selected' : ''}>${escape(target.label)} (${counts.get(target.id).total})</option>`).join('')}</optgroup>` : ''; }).join('')}</select></label>` : ''}<label class="repeated-filter"><input type="checkbox" id="repeated-targets" ${repeatedOnly ? 'checked' : ''}>只看同目标多项启用<span class="filter-count">${repeated}</span></label><span class="taxonomy-hint">按同一角色 / 枪械集中查看，可逐项禁用对照。</span></div></section>`;
}
function renderLibrary() {
  const installed = state.items.filter(item => item.source !== 'cache');
  main.innerHTML = heading('模组管理', '整理你的世界，准备下一次并肩作战。', button('刷新', 'scan', 'refresh') + button('导入内容', 'import', 'plus', 'primary')) + `
    <section class="hero"><img class="hero-art" src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/550/library_hero.jpg" alt=""><div class="hero-content"><div class="hero-eyebrow"><i></i> YOUR NEXT ADVENTURE STARTS HERE</div><h2>下一站，安全屋。</h2><p>装上喜欢的地图和 Mod，和队友再出发。<br>属于你的求生之路，从这里开始。</p><div class="hero-bottom">${button('启动游戏', 'launch', 'play')}<span class="hero-hint">${icon(state.gameRoot ? 'check' : 'folder')}${state.gameRoot ? '游戏目录已就绪' : '先连接你的游戏目录'}</span></div></div><div class="hero-corner">LEFT 4 DEAD <b>2</b></div></section>
    <div class="stats"><div class="stat"><div class="stat-icon">${icon('package')}</div><div><p class="stat-label">已安装内容</p><strong>${installed.length}<small>项</small></strong></div></div><div class="stat"><div class="stat-icon">${icon('check')}</div><div><p class="stat-label">已启用</p><strong>${installed.filter(item => item.enabled).length}<small>项</small></strong></div></div><div class="stat"><div class="stat-icon">${icon('drive')}</div><div><p class="stat-label">内容占用</p><strong>${bytes(installed.reduce((sum, item) => sum + item.size, 0)).split(' ')[0]}<small>${bytes(installed.reduce((sum, item) => sum + item.size, 0)).split(' ')[1]}</small></strong></div></div><div class="stat"><div class="stat-icon">${icon('steam')}</div><div><p class="stat-label">Steam 状态</p><strong>${state.steam?.running ? '在线' : '离线'}</strong></div></div></div>
    <div id="transfer-panel"></div><div class="section-heading"><h2>模组库 <span>让每一份热爱井井有条</span></h2><div class="view-switch" aria-label="视图"><button data-layout="grid" class="${layout === 'grid' ? 'active' : ''}" aria-label="网格视图">${icon('library')}</button><button data-layout="list" class="${layout === 'list' ? 'active' : ''}" aria-label="列表视图">${icon('list')}</button></div></div>
    <div class="filterbar"><div class="filters primary-filters">${[['all', '全部'], ...Object.entries(types), ['disabled', '已禁用']].map(([value, title]) => `<button class="chip ${filter === value ? 'active' : ''}" data-filter="${value}">${title}<span class="filter-count">${state.items.filter(item => inCategory(item, value)).length}</span></button>`).join('')}</div><div class="tools"><label class="search">${icon('search')}<input type="search" id="library-search" maxlength="200" placeholder="中英通搜：名称、角色或枪械…" value="${escape(query)}" aria-label="搜索本地内容"></label><select class="sort" id="library-sort" aria-label="排序"><option value="updated" ${sort === 'updated' ? 'selected' : ''}>最近更新</option><option value="name" ${sort === 'name' ? 'selected' : ''}>名称排序</option><option value="slot" ${sort === 'slot' ? 'selected' : ''}>替换目标</option><option value="size" ${sort === 'size' ? 'selected' : ''}>占用空间</option></select></div></div><div id="library-taxonomy"></div><div id="library-content"></div>`;
  renderTransfers();
  renderTaxonomy();
  renderLibraryContent();
}
function workshopLabels(item) {
  const local = state.items.filter(value => value.workshopId === item.id && value.source !== 'cache').flatMap(value => itemTargets(value));
  return window.SafehouseWorkshopLabels.describe(item, local);
}
function workshopTagMarkup(item, detail = false) {
  const labels = workshopLabels(item), limit = detail ? labels.length : 6;
  return `<div class="target-tags workshop-tags" aria-label="工坊内容分类">${labels.slice(0, limit).map(tag => `<span class="target-tag ${['title', 'unknown'].includes(tag.source) ? 'inferred' : ''}" data-classification="${escape(tag.id)}" data-source="${tag.source}" title="${escape(`${tag.sourceLabel}${tag.evidence ? `：${tag.evidence}` : ''}`)}">${escape(tag.label)}${tag.source === 'title' ? ' · 推测' : ''}</span>`).join('')}${labels.length > limit ? `<span class="target-tag">+${labels.length - limit}</span>` : ''}</div>${detail ? '<p class="info-line">分类参考作者标签与替换说明，标题推测单独标出。悬停标签可查看依据；安装后以本地 VPK 实际资源为准。</p>' : ''}`;
}
function card(item, community = false) {
  const targets = itemTargets(item), counts = community ? new Map() : targetStatistics();
  const targetTags = !community && targets.length ? `<div class="target-tags">${targets.slice(0, 4).map(target => `<button class="target-tag" data-action="view-target" data-target="${target.id}" title="查看所有替换 ${escape(target.label)} 的内容">${escape(target.label)}</button>`).join('')}${targets.length > 4 ? `<span class="target-tag">+${targets.length - 4} 个目标</span>` : ''}</div>` : '';
  const shared = community || item.source === 'cache' ? [] : targets.filter(target => replacementSlot(target) && counts.get(target.id)?.enabled > 1);
  const sharedTag = shared.length ? `<button class="same-target-badge" data-action="view-target" data-target="${shared[0].id}" title="同目标多项启用仅提示替换范围重叠，打开后可逐项禁用对照">同目标已启用 ${counts.get(shared[0].id).enabled} 项</button>` : '';
  return `<article class="content-card ${selected.has(item.id) && !community ? 'selected' : ''}"><div class="cover ${escape(item.type || 'mod')}" data-detail="${item.id}" data-community="${community}">${item.image ? `<img src="${escape(item.image)}" alt="" loading="lazy">` : icon(item.type === 'mod' ? 'package' : item.type || 'package')}${!community && item.source !== 'cache' ? `<label class="card-select" aria-label="选择 ${escape(item.title)}"><input type="checkbox" data-select="${item.id}" ${selected.has(item.id) ? 'checked' : ''}></label>` : ''}<span class="tag">${community ? '创意工坊' : types[item.type] || '未识别内容'}</span></div><div class="card-content"><button class="card-title" title="${escape(item.title)}" data-detail="${item.id}" data-community="${community}">${escape(item.translatedTitle || item.title)}</button>${item.translatedTitle && item.translatedTitle !== item.title ? `<p class="card-original" title="${escape(item.title)}">${escape(item.title)}</p>` : ''}<p class="card-subtitle">${community ? escape(item.author || `工坊 ID · ${item.id}`) : item.error ? `读取失败 · ${escape(item.error)}` : `${escape(item.author)}<span> · </span>${bytes(item.size)}`}</p>${community ? workshopTagMarkup(item) : targetTags}${sharedTag}${cardTransfer(item, community)}<div class="card-actions">${subscriptionControls(item, community)}<button class="button small" data-detail="${item.id}" data-community="${community}">${icon('info')}详情</button></div><div class="card-bottom"><span class="source-label">${icon(community || item.source !== 'local' ? 'steam' : 'folder')}${community ? 'Steam Workshop' : sources[item.source]}</span>${community ? '' : item.source === 'cache' ? '<span class="source-label">等待同步</span>' : `<button class="switch" role="switch" aria-checked="${item.enabled}" aria-label="${item.enabled ? '禁用' : '启用'} ${escape(item.title)}" data-toggle="${item.id}">${item.enabled ? '已启用' : '已禁用'}<span class="switch-track"></span></button>`}</div></div></article>`;
}
function renderLibraryContent() {
  const content = document.querySelector('#library-content'); if (!content) return;
  document.querySelector('#library-search-note')?.remove(); content.insertAdjacentHTML('beforebegin', `<div id="library-search-note">${searchNote(localSearch)}</div>`);
  const items = filteredItems(), selectable = items.filter(item => item.source !== 'cache');
  content.innerHTML = `${!state.gameRoot ? `<div class="notice">${icon('folder')}<span>还没有连接游戏目录。自动识别或手动选择后，就能在这里管理所有内容。</span>${button('选择目录', 'choose-game', '', 'small')}</div>` : ''}${state.warnings.length ? `<div class="notice">${icon('warning')}<span>${escape(state.warnings.join('；'))}</span></div>` : ''}${state.items.some(item => item.error) ? `<div class="notice error">${icon('warning')}<span>部分 VPK 无法解析。打开对应内容可查看原因。</span></div>` : ''}
    ${items.length ? `<div class="selectionbar"><input type="checkbox" id="select-all" aria-label="全选当前结果" ${selectable.length && selectable.every(item => selected.has(item.id)) ? 'checked' : ''} ${!selectable.length ? 'disabled' : ''}><span>${selected.size ? `已选择 ${selected.size} 项` : '选择内容以批量管理'}</span><div class="spacer"></div>${selected.size ? button('启用', 'bulk-enable', 'check', 'small') + button('禁用', 'bulk-disable', 'minus', 'small') + button('卸载', 'bulk-uninstall', 'trash', 'small danger') : '<span class="subtle">支持拖入 VPK / ZIP</span>'}</div><div class="content-grid ${layout === 'list' ? 'list-view' : ''}">${items.map(item => card(item)).join('')}</div><div class="content-foot"><span>显示 ${items.length} 项内容</span><p>${icon('info')}启停状态在下次加载游戏内容时生效</p></div>` : empty('package', state.items.length ? '没有找到匹配内容' : '给安全屋添点新内容', state.items.length ? '换个关键词或分类试试。' : '将 VPK / ZIP 拖到窗口，或前往创意工坊发现地图与 Mod。你的文件会出现在这里。', button(state.gameRoot ? '导入第一份内容' : '连接游戏目录', state.gameRoot ? 'import' : 'choose-game', state.gameRoot ? 'plus' : 'folder', 'primary'))}`;
}
function consoleBounds() {
  const element = document.querySelector('#console-viewport'); if (!element) return null;
  const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
}
function renderConsole() {
  if (document.querySelector('#console-viewport')) return;
  const zoom = state.settings.consoleZoom || 'auto';
  if (!state.settings.consoleUrl && !consoleState.url) consoleAddressExpanded = true;
  main.innerHTML = `<div class="page-heading console-heading"><h1>中心控制台</h1><div class="actions"><label class="console-zoom-label">缩放<select id="console-zoom" aria-label="面板缩放">${[["auto", "自动适配"], [0.7, "70%"], [0.8, "80%"], [0.9, "90%"], [1, "100%"], [1.1, "110%"], [1.25, "125%"]].map(([value, label]) => `<option value="${value}" ${zoom === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>${button("面板地址", "console-address", "settings", "small", `aria-expanded="${consoleAddressExpanded}"`)}${button(consoleWide ? "退出宽屏" : "宽屏模式", "console-wide", "square", "small", `aria-pressed="${consoleWide}"`)}${button("浏览器打开", "console-open", "external", "small")}${button("重新连接", "console-reload", "refresh", "small")}</div></div><form class="console-connect" id="console-connect" ${consoleAddressExpanded ? "" : "hidden"}><label for="console-url">面板地址</label><input id="console-url" type="url" required maxlength="2048" value="${escape(state.settings.consoleUrl || consoleState.url || "")}" placeholder="https://服务器地址:4174/" aria-label="服务器面板地址"><button class="button primary small" type="submit">连接并保存</button></form><div class="console-summary"><span id="console-status" role="status"></span><span>直连下载由客户端接管</span></div><div id="transfer-panel"></div><section id="console-viewport" aria-label="服务器管理面板"><div id="console-placeholder"></div></section>`;
  renderConsoleStatus(); renderTransfers(); consoleObserver?.disconnect();
  consoleObserver = new ResizeObserver(() => { if (page === 'console' && api?.consoleBounds) call('consoleBounds', consoleBounds()).catch(error => toast(error.message)); });
  consoleObserver.observe(document.querySelector('#console-viewport'));
  call('consoleShow', consoleBounds()).then(value => { consoleState = value; if (page === 'console') renderConsoleStatus(); }).catch(error => { consoleState = { ...consoleState, status: 'error', message: error.message }; renderConsoleStatus(); });
}
function renderConsoleStatus() {
  renderServerConnection();
  const status = document.querySelector('#console-status'), placeholder = document.querySelector('#console-placeholder'); if (!status || !placeholder) return;
  const statuses = { idle: '待连接', loading: '正在连接', ready: '已连接', auth: '需要登录', error: '连接失败' };
  status.textContent = `${statuses[consoleState.status] || '待连接'} · ${consoleState.message || ''}`;
  status.dataset.status = consoleState.status;
  if (consoleState.status === 'ready') { placeholder.innerHTML = ''; return; }
  if (consoleState.status === 'idle' && !consoleState.url) { placeholder.innerHTML = empty('drive', '连接你的服务器面板', '在上方填写面板地址并连接，已有设置会自动保留。'); return; }
  if (consoleState.status === 'auth') {
    if (!placeholder.querySelector('#console-auth')) placeholder.innerHTML = `<div class="console-login"><div class="empty-symbol">${icon('shield')}</div><h2>登录服务器面板</h2><p>${escape(consoleState.url)}<br>使用现有面板账号，密码仅用于本次会话。</p><form id="console-auth"><label>账号<input name="username" autocomplete="username" required maxlength="256" aria-label="面板账号"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="1024" aria-label="面板密码"></label><button class="button primary" type="submit">登录控制台</button></form></div>`;
  } else placeholder.innerHTML = empty(consoleState.status === 'error' ? 'warning' : 'globe', consoleState.status === 'error' ? '暂时无法连接面板' : '正在打开中心控制台', escape(consoleState.message || '请稍候…'), consoleState.status === 'error' ? button('重试连接', 'console-reload', 'refresh', 'primary') : '');
}
function renderWorkshop() {
  main.innerHTML = heading('创意工坊', '按社群常用分类发现新的战役、角色和 Mod。', button('打开 Steam 社区', 'open-community', 'external')) + `<form class="workshop-search" id="workshop-form"><label class="search">${icon('search')}<input type="search" id="workshop-search" value="${escape(workshop.query)}" maxlength="200" placeholder="中英通搜：地图、Mod，或粘贴工坊 ID / 链接" aria-label="搜索创意工坊"></label><button class="button primary" type="submit">搜索内容</button></form><div class="workshop-controls"><label class="workshop-category-label">分类<select class="sort workshop-category" id="workshop-category" aria-label="工坊分类">${workshopCategories.map(([value, label]) => `<option value="${value}" ${workshop.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div id="workshop-taxonomy"></div><span class="translation-badge">${icon('translate')}${state.settings.autoTranslate ? `自动翻译为 ${escape(uiLanguages[state.settings.language] || state.settings.language)}` : '显示社区原文'}</span></div><div class="notice info workshop-note">${icon('steam')}<span>${state.steam?.ugc?.ready ? '已连接本机 Steam：可在此订阅、下载和取消订阅，完成后自动安装到模组管理；取消订阅会卸载本地副本。' : `公开浏览无需登录。${escape(state.steam?.ugc?.error || '请打开本机 Steam 后在此订阅和下载。')}`}</span></div><div id="transfer-panel"></div><div id="workshop-content"></div>`;
  renderWorkshopTaxonomy();
  renderTransfers();
  renderWorkshopContent();
}
function renderWorkshopTaxonomy() {
  const container = document.querySelector('#workshop-taxonomy'); if (!container) return;
  const options = window.SafehouseWorkshopCatalog.categories[workshop.category].children;
  container.innerHTML = `<label class="workshop-category-label">${workshop.category === 'survivor' ? '具体角色' : workshop.category === 'weapon' ? '武器类型' : '细分类'}<select class="sort workshop-subcategory" id="workshop-subcategory" aria-label="工坊细分类"><option value="all">全部细分类</option>${options.map(([value, label]) => `<option value="${value}" ${workshop.subcategory === value ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select></label>`;
}
function renderWorkshopContent() {
  const content = document.querySelector('#workshop-content'); if (!content) return;
  document.querySelector('#workshop-search-note')?.remove(); content.insertAdjacentHTML('beforebegin', `<div id="workshop-search-note">${searchNote(workshop.search)}</div>`);
  if (workshop.loading) { content.innerHTML = `<div class="content-grid">${'<div class="skeleton"></div>'.repeat(6)}</div>`; return; }
  if (workshop.error) { content.innerHTML = empty('globe', '社区暂时没有回应', escape(workshop.error), button('重新加载', 'reload-workshop', 'refresh', 'primary')); return; }
  content.innerHTML = `${workshop.translationError ? `<div class="notice">${icon('translate')}<span>部分内容保留原文：${escape(workshop.translationError)}</span></div>` : ''}${workshop.items.length ? `<div class="content-grid">${workshop.items.map(item => card(item, true)).join('')}</div><div class="pager">${button('上一页', 'previous-page', '', 'small', workshop.page <= 1 ? 'disabled' : '')}<span>第 ${workshop.page} 页</span>${button('下一页', 'next-page', '', 'small', !workshop.hasMore ? 'disabled' : '')}</div>` : empty('search', '这里还没有内容', '试试其他关键词、分类，或直接粘贴创意工坊项目 ID。')}`;
}
async function loadWorkshop() {
  const generation = ++workshop.generation;
  workshop.loading = true; workshop.error = ''; workshop.translationError = ''; workshop.search = { original: workshop.query, queries: window.SafehouseSearch.aliases(workshop.query), warning: '' }; renderWorkshopContent();
  try {
    const result = await call('search', workshop.query, workshop.page, workshop.category, workshop.subcategory);
    if (generation !== workshop.generation) return;
    Object.assign(workshop, result, { loading: false, loaded: true }); renderWorkshopContent();
    if (state.settings.autoTranslate) {
      const waiting = [...workshop.items];
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (waiting.length && generation === workshop.generation) {
          const item = waiting.shift();
          try { const result = await call('translate', item.title); if (generation === workshop.generation) item.translatedTitle = result.text; }
          catch (error) { if (generation === workshop.generation) workshop.translationError = error.message; }
        }
      }));
      if (generation === workshop.generation) renderWorkshopContent();
    }
  } catch (error) { if (generation === workshop.generation) { workshop.loading = false; workshop.error = error.message; renderWorkshopContent(); } }
}
function renderTransfers() {
  const container = document.querySelector('#transfer-panel'); if (!container) return;
  const jobs = state.downloads.filter(job => page === 'console' ? job.kind === 'panel' : page !== 'workshop' || job.kind === 'workshop');
  if (!jobs.length) { container.innerHTML = ''; return; }
  const active = jobs.filter(job => activeStatuses.includes(job.status)).length;
  const expanded = transfersExpanded ?? (active > 0 || jobs.some(job => job.kind === 'panel' && ['downloaded', 'failed', 'cancelled'].includes(job.status) && !job.installQueued));
  container.innerHTML = `<section class="transfer-panel" aria-label="模组任务"><div class="transfer-heading"><button class="transfer-toggle" data-action="toggle-transfers" aria-expanded="${expanded}">${icon('download')}<b>模组任务</b><span>${active ? `${active} 项进行中` : `${jobs.length} 项记录`}</span>${icon(expanded ? 'minus' : 'plus')}</button>${button('清理已结束', 'clear-downloads', 'trash', 'small')}</div>${expanded ? `<div class="transfer-jobs">${jobs.map(job => `<article class="job"><div class="job-icon ${job.status}">${icon(job.status === 'completed' ? 'check' : job.status === 'failed' ? 'warning' : job.kind === 'workshop' ? 'steam' : 'package')}</div><div class="job-info"><h3>${escape(job.title)}</h3><p>${job.kind === 'workshop' ? `Steam 工坊 · ${escape(job.workshopId)}` : job.kind === 'panel' ? `面板直连 · ${escape(job.filename)}` : `本地导入 · ${escape(job.filename)}`}${job.files?.length ? ` · ${job.files.length} 个 VPK` : ''}</p>${jobProgress(job)}${job.error ? `<p class="job-error">${escape(job.error)}</p>` : ''}</div><div class="job-actions"><span class="job-status">${jobStatus[job.status] || escape(job.status)}</span>${['import', 'panel'].includes(job.kind) && activeStatuses.includes(job.status) ? button('取消', 'cancel-download', '', 'small', `data-id="${job.id}"`) : job.kind === 'import' && ['failed', 'cancelled'].includes(job.status) ? button('重试', 'retry-download', 'refresh', 'small', `data-id="${job.id}"`) : job.kind === 'panel' && job.status === 'downloaded' ? (job.installQueued ? button('查看模组管理', 'panel-library', '', 'small') : button('安装到模组管理', 'panel-install', 'plus', 'small primary', `data-id="${job.id}"`)) + button('打开文件夹', 'panel-reveal', 'folder', 'small', `data-id="${job.id}"`) : job.kind === 'panel' && ['failed', 'cancelled'].includes(job.status) ? '<span class="subtle">请从面板重新获取直链</span>' : job.kind === 'workshop' && job.status !== 'cancelled' ? subscriptionControls({ id: job.workshopId }, true) + (['steam', 'failed'].includes(job.status) ? button('重试下载', 'subscribe-item', 'refresh', 'small', `data-id="${job.workshopId}" ${state.steam?.ugc?.ready ? '' : 'disabled'}`) : '') : ''}</div></article>`).join('')}</div>` : ''}</section>`;
}
function jobProgress(job) {
  if (!activeStatuses.includes(job.status)) return '';
  const measured = ['installing', 'downloading'].includes(job.status) && job.total > 0;
  return `<div class="progress"><progress max="${job.total || 1}" ${measured ? `value="${Math.min(job.bytes || 0, job.total)}"` : ''} aria-label="下载与安装进度"></progress></div><p>${jobStatus[job.status]}${measured ? ` · ${bytes(job.bytes)} / ${bytes(job.total)}` : ''}</p>`;
}
function workshopKey(item, community = false) { return community ? item.id : item.workshopId || ''; }
function subscriptionState(item, community = false) {
  const id = workshopKey(item, community);
  if (!id) return null;
  const ids = state.steam?.ugc?.subscribedIds;
  return Array.isArray(ids) ? ids.includes(id) : typeof item.subscribed === 'boolean' ? item.subscribed : null;
}
function subscriptionControls(item, community = false) {
  const id = workshopKey(item, community);
  if (!id) return !community && item.source === 'local'
    ? button('删除', 'delete-local', 'trash', 'small danger', `data-id="${item.id}" title="将游戏中安装的副本移至回收站，保留原始导入文件" aria-label="删除 ${escape(item.title)}"`)
    : '<span class="local-mod-label">本地模组</span>';
  const subscribed = subscriptionState(item, community), ready = state.steam?.ugc?.ready;
  return button(subscribed ? '取消订阅' : subscribed === false ? '订阅' : '读取订阅状态', subscribed ? 'unsubscribe-item' : 'subscribe-item', subscribed ? 'check' : 'plus', `small ${subscribed ? 'subscribed' : 'primary'}`, `data-id="${id}" title="${subscribed ? '取消订阅并卸载该工坊项目的本地副本' : ready ? '订阅并自动下载安装' : '请连接本机 Steam 以读取订阅状态'}" ${ready && subscribed !== null ? '' : 'disabled'}`);
}
function cardTransfer(item, community) {
  const id = workshopKey(item, community); if (!id) return '';
  const job = state.downloads.find(job => job.workshopId === id);
  if (!job || !activeStatuses.includes(job.status) && job.status !== 'failed') return '';
  return `<div class="card-transfer">${jobProgress(job)}${job.status === 'failed' ? `<p>${escape(job.error || '下载或安装失败，可重试')}</p>` : ''}</div>`;
}
function renderSettings() {
  main.innerHTML = heading('偏好设置', '让安全屋按照你的习惯运转。') + `<section class="section-card"><div class="section-card-heading">${icon('folder')}<h3>游戏与内容目录</h3></div><div class="preference"><div><b>求生之路 2 安装目录</b><p>${escape(state.gameRoot || '尚未连接游戏目录')}</p></div>${button('自动识别', 'scan', 'refresh', 'small')}${button('选择目录', 'choose-game', 'folder', 'small')}</div>${state.paths.length ? `<div class="path-list">${state.paths.map(value => `<div>${escape(value)}</div>`).join('')}</div>` : ''}${state.discoveryWarnings.length ? `<div class="path-list">${state.discoveryWarnings.map(value => `<p>${escape(value)}</p>`).join('')}</div>` : ''}</section>
    <section class="section-card"><div class="section-card-heading">${icon('steam')}<h3>Steam 本地状态</h3></div><div class="preference"><div><b>${state.steam?.account ? escape(state.steam.account.name) : '未找到本地 Steam 账号'}</b><p>${state.steam?.account ? `SteamID · ${escape(state.steam.account.steamId)}` : '未读取到 loginusers.vdf，请先在本机登录过 Steam。'}<br>${state.steam?.running ? 'Steam 客户端正在运行' : 'Steam 客户端未运行'}<br>${state.steam?.ugc?.ready ? '订阅与下载接口已连接' : escape(state.steam?.ugc?.error || '订阅接口尚未连接')}${state.steam?.root ? `<br>Steam 根目录 · ${escape(state.steam.root)}` : ''}</p></div>${state.steam?.running ? '' : button('打开 Steam', 'open-steam', 'steam', 'small primary')}</div></section>
    <section class="section-card"><div class="section-card-heading">${icon('translate')}<h3>语言与翻译</h3></div><div class="preference"><div><b>自动翻译社区内容</b><p>标题和详情自动翻译，始终可以查看原文。<br>在线翻译使用 Google 翻译服务，会发送社区公开文字；网络不可用时显示原文和失败原因。</p></div><button class="switch large" role="switch" aria-checked="${state.settings.autoTranslate}" data-action="toggle-translation" aria-label="自动翻译社区内容"><span class="switch-track"></span></button></div><div class="preference"><div><b>翻译目标语言</b><p>首次启动跟随系统语言 · 当前系统 ${escape(state.language)}</p></div><select id="language-select" aria-label="翻译语言">${!uiLanguages[state.settings.language] ? `<option value="${escape(state.settings.language)}">系统 · ${escape(state.settings.language)}</option>` : ''}${Object.entries(uiLanguages).map(([value, name]) => `<option value="${value}" ${value === state.settings.language ? 'selected' : ''}>${name}</option>`).join('')}</select></div></section>
    <section class="section-card"><div class="section-card-heading">${icon('sun')}<h3>外观</h3></div><div class="preference"><div><b>应用主题</b><p>Miuix / HyperOS 设计风格，柔和表面与蓝色强调色。</p></div><select id="theme-select" aria-label="应用主题">${[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([value, name]) => `<option value="${value}" ${state.settings.theme === value ? 'selected' : ''}>${name}</option>`).join('')}</select></div></section><p class="info-line">Safehouse v${escape(state.version)} · 为热爱求生之路的你而做。<br><button data-action="project-repository">GitHub 源码与更新</button> · © 2026 Z1og · 非商业使用，商用需授权。<br>界面参考 <button data-action="open-miuix">Miuix</button>，以 Electron 实现桌面交互。与 Valve / Steam 无隶属关系。</p>`;
}
async function showDetail(id, isCommunity = false) {
  const request = ++detailRequest;
  detail = null; detailTranslated = null; showOriginal = false;
  const dialog = document.querySelector('#details-dialog'), content = document.querySelector('#details-content');
  if (!dialog.open) dialog.showModal();
  content.innerHTML = '<div class="startup"><span class="spinner"></span><p>正在读取内容详情…</p></div>';
  try {
    const item = isCommunity ? await call('details', id) : state.items.find(item => item.id === id);
    if (request !== detailRequest || !dialog.open) return;
    if (!item) throw new Error('内容不存在，请刷新后重试');
    detail = { ...item, community: isCommunity }; renderDetail();
    if (isCommunity && state.settings.autoTranslate) {
      const current = detail;
      try {
        const [title, description] = await Promise.all([call('translate', item.title), item.description ? call('translate', item.description) : Promise.resolve({ text: '' })]);
        if (detail === current) { detailTranslated = { title: title.text, description: description.text }; renderDetail(); }
      } catch (error) { if (detail === current) { detail.translationError = error.message; renderDetail(); } }
    }
  } catch (error) { if (request === detailRequest && dialog.open) content.innerHTML = `<div class="detail-body">${empty('warning', '无法打开内容', escape(error.message))}</div>`; }
}
function renderDetail() {
  if (!detail) return;
  const translated = detailTranslated && !showOriginal;
  document.querySelector('#details-content').innerHTML = `${detail.image ? `<img class="detail-cover" src="${escape(detail.image)}" alt="">` : `<div class="detail-cover fallback">${icon(detail.type || 'package')}</div>`}<div class="detail-body"><h2>${escape(translated ? detailTranslated.title : detail.title)}</h2><div class="detail-meta"><span>${escape(detail.author)}</span><span>${detail.community ? `Steam 工坊 · ${detail.id}` : types[detail.type]}</span><span>${bytes(detail.size)}</span>${!detail.community ? `<span>${detail.resourceCount} 个资源</span>` : ''}</div>${detail.community && state.settings.autoTranslate ? `<div class="detail-translation">${icon('translate')}${detailTranslated ? `已翻译为 ${escape(state.settings.language)} <button data-action="toggle-original">${showOriginal ? '查看翻译' : '查看原文'}</button>` : detail.translationError ? `保留原文：${escape(detail.translationError)}` : '<span class="spinner small"></span>正在翻译…'}</div>` : ''}<p class="detail-description">${escape(translated ? detailTranslated.description || '作者尚未提供描述。' : detail.description || '作者尚未提供描述。')}</p>${detail.error ? `<div class="notice error">${icon('warning')}${escape(detail.error)}</div>` : ''}${detail.community ? workshopTagMarkup(detail, true) : ''}${!detail.community ? `<div class="detail-file">${escape(detail.file)}</div>` : ''}<div class="detail-footer">${subscriptionControls(detail, detail.community)}${detail.community ? (subscriptionState(detail, true) ? button('重新下载 / 更新', 'subscribe-item', 'download', '', `data-id="${detail.id}" ${state.steam?.ugc?.ready ? '' : 'disabled'}`) : '') + button('官方页面', 'open-item', 'external', '', `data-id="${detail.id}"`) : button('在文件夹中显示', 'reveal-item', 'folder', '', `data-id="${detail.id}"`) + (detail.source !== 'cache' ? button(detail.enabled ? '禁用内容' : '启用内容', 'toggle-detail', '', 'soft', `data-id="${detail.id}"`) : '')}</div>${detail.community ? `<p class="info-line">${state.steam?.ugc?.ready ? '使用本机 Steam 当前账号执行订阅与下载。取消订阅会停止当前任务，并把该项目在游戏 addons 中的副本移至回收站。' : escape(state.steam?.ugc?.error || '请先运行本机 Steam 并登录拥有游戏的账号。')}</p>` : ''}</div>`;
  if (!detail.community) {
    const counts = targetStatistics(), targets = itemTargets(detail);
    const source = { resource: '包内模型 / 材质 / 脚本等实际路径', metadata: '作者填写的 AddonInfo', unknown: '尚无足够依据' }[detail.classificationSource] || '尚无足够依据';
    const markup = `<section class="detail-targets"><h3>替换目标与识别依据</h3><p class="classification-source">${source}</p>${targets.map(target => `<div class="detail-target"><div><b>${escape(target.label)}</b><span>${types[target.type]} · ${categoryGroups[target.type]?.[target.group] || ''}${replacementSlot(target) ? ` · 已安装 ${counts.get(target.id)?.installed || 0} / 已启用 ${counts.get(target.id)?.enabled || 0}` : ''}</span></div>${button('查看同目标', 'view-target', '', 'small', `data-target="${target.id}"`)}${target.evidence?.length ? `<ul>${target.evidence.map(path => `<li><code>${escape(path)}</code></li>`).join('')}</ul>` : '<p class="classification-source">未识别出具体资源路径，暂按作者声明归类。</p>'}</div>`).join('') || '<p>暂未识别出具体替换目标。</p>'}<p class="classification-source">同目标多项启用表示替换范围重叠，可逐项禁用对照；不同资源组成的包也可能兼容。</p></section>`;
    document.querySelector('#details-content .detail-footer').insertAdjacentHTML('beforebegin', markup);
  }
}
async function changeEnabled(ids, enabled) {
  await call('enable', ids, enabled); await refresh(); toast(`${ids.length} 项内容已${enabled ? '启用' : '禁用'}，下次加载游戏内容时生效`);
  if (detail && !detail.community && ids.includes(detail.id)) { detail = { ...state.items.find(item => item.id === detail.id), community: false }; renderDetail(); }
}
async function uninstallItems(ids) {
  try {
    const result = await call('uninstall', ids);
    if (result.cancelled) return;
    result.removed.forEach(id => selected.delete(id));
    toast(`${result.removed.length} 项内容已移至回收站`);
  } finally {
    await refresh();
    // A partial trash operation can succeed before another file fails.
    for (const id of selected) if (!state.items.some(item => item.id === id)) selected.delete(id);
    if (detail && !detail.community && !state.items.some(item => item.id === detail.id)) {
      document.querySelector('#details-dialog').close(); detail = null;
    }
  }
}
const actions = {
  'view-target': element => {
    const target = targetCatalog.find(target => target.id === element.dataset.target); if (!target) return;
    document.querySelector('#details-dialog').close(); detail = null;
    page = 'library'; filter = target.type; subfilter = 'all'; slotFilter = target.id; query = ''; repeatedOnly = false;
    render(); document.querySelector('.filterbar')?.scrollIntoView({ block: 'start' });
  },
  scan: async () => { state = await call('scan'); render(); toast(state.gameRoot ? `已完成扫描 · ${state.items.length} 项内容` : '未自动找到游戏，请手动选择安装目录'); },
  import: async () => {
    const previous = new Set(state.downloads.map(job => job.id));
    const jobs = await call('chooseImports'); await refresh();
    if (jobs.some(job => !previous.has(job.id))) { transfersExpanded = true; page = 'library'; render(); document.querySelector('#transfer-panel')?.scrollIntoView({ block: 'start' }); }
  },
  'choose-game': async () => { state = await call('chooseGame'); render(); },
  launch: () => call('launch'),
  'open-steam': () => call('openSteam'),
  'bulk-enable': () => changeEnabled([...selected], true),
  'bulk-disable': () => changeEnabled([...selected], false),
  'bulk-uninstall': () => uninstallItems([...selected]),
  'delete-local': element => {
    const item = state.items.find(item => item.id === element.dataset.id);
    if (!item || item.source !== 'local' || workshopKey(item)) throw new Error('内容已经变化，请刷新后重试');
    return uninstallItems([item.id]);
  },
  'disable-one': element => changeEnabled([element.dataset.id], false),
  'local-detail': element => showDetail(element.dataset.id),
  'close-dialog': () => { document.querySelector('#details-dialog').close(); detail = null; },
  'toggle-original': () => { showOriginal = !showOriginal; renderDetail(); },
  'open-community': () => call('open', 'https://steamcommunity.com/app/550/workshop/'),
  'open-miuix': () => call('open', 'https://compose-miuix-ui.github.io/miuix/zh_CN/'),
  'project-group': async () => { const group = await call('copyGroup'); toast(`QQ群号 ${group} 已复制，在 QQ 搜索加入`); },
  'project-repository': () => call('projectLink', 'repository'),
  'open-item': element => call('open', `https://steamcommunity.com/sharedfiles/filedetails/?id=${element.dataset.id}`),
  'subscribe-item': async element => { await call('subscribe', element.dataset.id); if (detail && workshopKey(detail, detail.community) === element.dataset.id) detail.subscribed = true; transfersExpanded = true; await refresh(); toast('已订阅，下载和安装进度显示在当前页面'); },
  'unsubscribe-item': async element => { try { const result = await call('unsubscribe', element.dataset.id); if (detail && workshopKey(detail, detail.community) === element.dataset.id) { if (detail.community) detail.subscribed = false; else { document.querySelector('#details-dialog').close(); detail = null; } } toast(`已取消订阅并卸载 ${result.removed.length} 个本地副本`); } finally { await refresh(); } },
  'reveal-item': element => call('reveal', element.dataset.id),
  'toggle-detail': element => { const item = state.items.find(item => item.id === element.dataset.id); return changeEnabled([item.id], !item.enabled); },
  'reload-workshop': () => loadWorkshop(),
  'go-workshop': async () => { page = 'workshop'; render(); await loadWorkshop(); },
  'previous-page': async () => { workshop.page = Math.max(1, workshop.page - 1); await loadWorkshop(); main.scrollTop = 0; },
  'next-page': async () => { workshop.page++; await loadWorkshop(); main.scrollTop = 0; },
  'toggle-transfers': element => { transfersExpanded = element.getAttribute('aria-expanded') !== 'true'; renderTransfers(); },
  'clear-downloads': async () => { await call('clearDownloads'); await refresh(); },
  'cancel-download': async element => { await call('cancel', element.dataset.id); await refresh(); },
  'retry-download': async element => { await call('retry', element.dataset.id); await refresh(); },
  'open-steam-downloads': () => call('steamDownloads'),
  'panel-install': async element => { await call('panelInstall', element.dataset.id); page = 'library'; await refresh(); },
  'panel-library': async () => { page = 'library'; await refresh(); },
  'panel-reveal': element => call('panelReveal', element.dataset.id),
  'console-address': element => { consoleAddressExpanded = !consoleAddressExpanded; document.querySelector('#console-connect').hidden = !consoleAddressExpanded; element.setAttribute('aria-expanded', consoleAddressExpanded); },
  'console-wide': element => { consoleWide = !consoleWide; document.body.classList.toggle('console-wide', consoleWide); element.innerHTML = icon('square') + (consoleWide ? '退出宽屏' : '宽屏模式'); element.setAttribute('aria-pressed', consoleWide); },
  'console-open': () => call('consoleOpen'),
  'copy-server-connection': async () => { await call('consoleCopyConnection'); toast('服务器连接命令已复制，可粘贴到游戏控制台'); },
  'console-reload': async () => { consoleState = await call('consoleReload'); renderConsoleStatus(); },
  'toggle-translation': async () => { await savePreferences({ autoTranslate: !state.settings.autoTranslate }); render(); },
};
document.addEventListener('click', event => {
  const windowButton = event.target.closest('[data-window]'); if (windowButton) { call('window', windowButton.dataset.window).catch(error => toast(error.message)); return; }
  const navigation = event.target.closest('[data-page]');
  if (navigation) { page = navigation.dataset.page; render(); main.scrollTop = 0; if (page === 'workshop' && !workshop.loaded) loadWorkshop(); return; }
  if (event.target.closest('.card-select')) return;
  const action = event.target.closest('[data-action]'); if (action && actions[action.dataset.action]) { task(() => actions[action.dataset.action](action)); return; }
  const category = event.target.closest('[data-filter]'); if (category) { filter = category.dataset.filter; subfilter = 'all'; slotFilter = 'all'; renderLibrary(); document.querySelector('.filterbar')?.scrollIntoView({ block: 'start' }); return; }
  const subcategory = event.target.closest('[data-subfilter]'); if (subcategory) { subfilter = subcategory.dataset.subfilter; slotFilter = 'all'; renderLibrary(); return; }
  const slot = event.target.closest('[data-slot]'); if (slot) { slotFilter = slot.dataset.slot; subfilter = 'all'; renderLibrary(); return; }
  const view = event.target.closest('[data-layout]'); if (view) { layout = view.dataset.layout; renderLibrary(); return; }
  const toggle = event.target.closest('[data-toggle]'); if (toggle) { const item = state.items.find(item => item.id === toggle.dataset.toggle); task(() => changeEnabled([item.id], !item.enabled)); return; }
  const detailButton = event.target.closest('[data-detail]'); if (detailButton) { showDetail(detailButton.dataset.detail, detailButton.dataset.community === 'true'); return; }
});
document.addEventListener('input', event => { if (event.target.id === 'library-search') updateLocalSearch(event.target.value); });
document.addEventListener('change', event => {
  if (event.target.id === 'console-zoom') task(async () => { const zoom = event.target.value === 'auto' ? 'auto' : Number(event.target.value); consoleState = await call('consoleZoom', zoom); state.settings.consoleZoom = zoom; });
  const target = event.target;
  if (target.dataset.select) { target.checked ? selected.add(target.dataset.select) : selected.delete(target.dataset.select); renderLibraryContent(); }
  if (target.id === 'select-all') { for (const item of filteredItems().filter(item => item.source !== 'cache')) target.checked ? selected.add(item.id) : selected.delete(item.id); renderLibraryContent(); }
  if (target.id === 'library-sort') { sort = target.value; renderLibraryContent(); }
  if (target.id === 'library-slot') { slotFilter = target.value; renderTaxonomy(); renderLibraryContent(); }
  if (target.id === 'repeated-targets') { repeatedOnly = target.checked; renderLibraryContent(); }
  if (target.id === 'workshop-category') { workshop.category = target.value; workshop.subcategory = 'all'; workshop.page = 1; workshop.loaded = false; renderWorkshopTaxonomy(); loadWorkshop(); }
  if (target.id === 'workshop-subcategory') { workshop.subcategory = target.value; workshop.page = 1; workshop.loaded = false; loadWorkshop(); }
  if (target.id === 'theme-select' || target.id === 'language-select') savePreferences({ [target.id === 'theme-select' ? 'theme' : 'language']: target.value }).catch(error => toast(error.message));
});
document.addEventListener('submit', event => {
  if (event.target.id === 'workshop-form') { event.preventDefault(); workshop.query = document.querySelector('#workshop-search').value.trim(); workshop.page = 1; loadWorkshop(); }
  if (event.target.id === 'console-connect') { event.preventDefault(); const url = document.querySelector('#console-url').value.trim(); task(async () => { consoleState = await call('consoleConnect', url); state.settings.consoleUrl = consoleState.url; renderConsoleStatus(); }); }
  if (event.target.id === 'console-auth') { event.preventDefault(); const form = event.target, username = form.elements.username.value, password = form.elements.password.value; form.elements.password.value = ''; task(async () => { consoleState = await call('consoleAuth', username, password); renderConsoleStatus(); }); }
});
document.querySelector('#details-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) { event.currentTarget.close(); detail = null; } } });
document.querySelector('#details-dialog').addEventListener('cancel', () => { detail = null; });
document.querySelector('#details-dialog').addEventListener('close', () => { detailRequest++; detail = null; });
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth++; document.querySelector('#drop-overlay').classList.add('visible'); } });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) document.querySelector('#drop-overlay').classList.remove('visible'); });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; document.querySelector('#drop-overlay').classList.remove('visible');
  const files = [...event.dataTransfer.files]; if (!files.length) return;
  task(async () => { const paths = files.map(file => api.filePath(file)); await call('import', paths); transfersExpanded = true; page = 'library'; await refresh(); document.querySelector('#transfer-panel')?.scrollIntoView({ block: 'start' }); });
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
if (api) {
  let refreshTimer;
  api.onChanged(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh(!['workshop', 'settings', 'console'].includes(page) && !document.querySelector('#library-search:focus, #library-slot:focus, #library-sort:focus')).catch(error => toast(error.message)), 250); });
  api.onDownloadsChanged?.(downloads => {
    if (!state || !Array.isArray(downloads)) return;
    state.downloads = downloads;
    renderTransfers();
  });
  api.onConsoleChanged?.(value => { consoleState = value; renderServerConnection(); if (page === 'console') renderConsoleStatus(); if (value.notice) toast(value.notice); });
}
refresh().catch(error => { main.innerHTML = empty('warning', '安全屋暂时无法打开', escape(error.message), button('重新扫描', 'scan', 'refresh', 'primary')); });

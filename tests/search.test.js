const test = require('node:test');
const assert = require('node:assert/strict');
const { aliases, matches } = require('../renderer/search-catalog');
const { SearchPlanner, BilingualSearch } = require('../core/search');
const { consoleUrl, configuredConsoleUrl, sameOrigin, viewBounds } = require('../core/console');

test('bilingual aliases keep compound queries and match both Chinese and English titles offline', () => {
  assert.deepEqual(aliases('尼克 女仆'), ['尼克 女仆', 'nick maid']);
  assert.deepEqual(aliases('初音未来'), ['初音未来', 'hatsune miku']);
  assert.ok(matches('Hatsune Miku Maid for Nick', aliases('初音 尼克')));
  assert.ok(matches('尼克女仆替换', aliases('Nick maid')));
  assert.ok(!matches('Maid for Zoey', aliases('尼克 女仆')));
  assert.ok(!matches('Nicolas', aliases('尼克')));
  assert.ok(matches('Silenced-SMG replacement', aliases('消音冲锋枪')));
});
test('planner translates arbitrary phrases, caches concurrent calls, and does not send IDs or known Chinese aliases', async () => {
  const calls = [], planner = new SearchPlanner({ translate: async (...args) => { calls.push(args); return { text: 'silver armor' }; } });
  const [first, second] = await Promise.all([planner.plan('银色盔甲'), planner.plan('银色盔甲')]);
  assert.deepEqual(first, second); assert.equal(calls.length, 1); assert.ok(first.queries.includes('silver armor'));
  assert.equal(calls[0][1], 'en'); assert.equal(calls[0][2].timeoutMs, 4500);
  await planner.plan('初音'); await planner.plan('3825637308'); await planner.plan('https://steamcommunity.com/sharedfiles/filedetails/?id=1');
  assert.equal(calls.length, 1);
  await planner.plan('custom armor'); assert.equal(calls[1][1], 'zh-CN');
  await assert.rejects(planner.plan('x'.repeat(201)), /200/);
});
test('planner clearly falls back when online translation is unavailable', async () => {
  const planner = new SearchPlanner({ translate: async () => { throw new Error('offline'); } });
  const plan = await planner.plan('银色盔甲');
  assert.deepEqual(plan.queries, ['银色盔甲']); assert.match(plan.warning, /原词/);
});
test('merged workshop results preserve filters, fill pages, deduplicate across pages, and support stable back navigation', async () => {
  const calls = [], planner = { plan: async () => ({ original: '初音', queries: ['初音', 'hatsune miku'], warning: '' }) };
  const community = { search: async (query, page, category, subcategory) => {
    calls.push([query, page, category, subcategory]);
    const start = query === '初音' ? 1 : 16;
    return { items: Array.from({ length: 30 }, (_, index) => ({ id: String(start + (page - 1) * 30 + index) })), hasMore: page < 2 };
  } };
  const search = new BilingualSearch(community, planner);
  const first = await search.search('初音', 1, 'survivor', 'nick'), second = await search.search('初音', 2, 'survivor', 'nick'), third = await search.search('初音', 3, 'survivor', 'nick');
  assert.equal(first.items.length, 30); assert.equal(second.items.length, 30); assert.equal(third.items.length, 15); assert.equal(third.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 75);
  assert.deepEqual(await search.search('初音', 1, 'survivor', 'nick'), first);
  assert.ok(calls.every(call => call[2] === 'survivor' && call[3] === 'nick')); assert.equal(calls.length, 4);
});
test('one unavailable workshop language returns successful results with a visible warning; all failures reject', async () => {
  const planner = { plan: async () => ({ original: '初音', queries: ['初音', 'hatsune miku'], warning: '' }) };
  const search = new BilingualSearch({ search: async query => { if (query === '初音') throw new Error('offline'); return { items: [{ id: '1' }], hasMore: false }; } }, planner);
  const result = await search.search('初音'); assert.equal(result.items.length, 1); assert.match(result.search.warning, /查询失败/);
  const failed = new BilingualSearch({ search: async () => { throw new Error('offline'); } }, planner);
  await assert.rejects(failed.search('初音'), /查询失败/);
});

test('bilingual pagination seeks distant pages with bounded requests and preserves cached back navigation', async () => {
  const calls = [], planner = { plan: async () => ({ original: 'test', queries: ['test', '测试'], warning: '' }) };
  const community = { search: async (query, page, category, subcategory) => {
    calls.push([page, category, subcategory]);
    return { items: Array.from({ length: 30 }, (_, index) => ({ id: `${query}-${page}-${index}` })), hasMore: page < 1000 };
  } };
  const search = new BilingualSearch(community, planner), first = await search.search('test', 1, 'weapon', 'rifle');
  const jump = await search.search('test', 80, 'weapon', 'rifle');
  assert.equal(jump.page, 80); assert.equal(jump.items.length, 30);
  assert.equal(calls.length, 4); assert.ok(calls.slice(2).every(value => value[0] === 80));
  assert.deepEqual(await search.search('test', 1, 'weapon', 'rifle'), first);
  assert.deepEqual(await search.search('test', 80, 'weapon', 'rifle'), jump);
  const next = await search.search('test', 81, 'weapon', 'rifle'); assert.equal(next.items.length, 30);
  assert.equal(new Set([...first.items, ...jump.items, ...next.items].map(value => value.id)).size, 90);
  assert.ok(calls.every(value => value[1] === 'weapon' && value[2] === 'rifle'));
  for (const page of [0, -1, 1.2, 1001]) await assert.rejects(search.search('test', page), /页码/);
});
test('console accepts HTTP(S) panel paths, rejects credential-bearing URLs and clamps native view bounds', () => {
  assert.equal(consoleUrl('http://panel.example.com:4174/#workshop'), 'http://panel.example.com:4174/#workshop');
  for (const url of ['file:///C:/test.html', 'javascript:alert(1)', 'https://admin:secret@example.com', 'steam://open/main']) assert.throws(() => consoleUrl(url));
  assert.ok(sameOrigin('http://localhost:4174/#maps', 'http://localhost:4174/'));
  assert.ok(!sameOrigin('http://localhost:4175/', 'http://localhost:4174/'));
  assert.deepEqual(viewBounds({ x: 250, y: 180, width: 5000, height: 5000 }, [1400, 940]), { x: 250, y: 180, width: 1150, height: 728 });
  assert.throws(() => viewBounds({ x: NaN }, [1400, 940]));
});

test('default console is unset and accepts the panel address supplied by the user', () => {
  assert.equal(configuredConsoleUrl(), '');
  assert.equal(configuredConsoleUrl(''), '');
  assert.equal(configuredConsoleUrl('https://panel.example.com:4174/admin?view=maps#workshop'), 'https://panel.example.com:4174/admin?view=maps#workshop');
  assert.equal(configuredConsoleUrl('http://localhost:4174/#maps'), 'http://localhost:4174/#maps');
  assert.throws(() => configuredConsoleUrl('https://admin:secret@example.com'));
  assert.throws(() => configuredConsoleUrl('file:///test'));
});

test('panel subframe and hash navigation cannot reset a loaded console to loading', () => {
  const { EventEmitter } = require('node:events');
  const { CenterConsole } = require('../core/console');
  const url = 'https://panel.example/';
  const contents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, getURL: () => url, isDestroyed: () => false, close() {} });
  const session = Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} });
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const electron = { app: new EventEmitter(), session: { fromPartition: () => session }, WebContentsView: class { constructor() { this.webContents = contents; } } };
  const panel = new CenterConsole({ electron, window, url, changed() {} });
  panel.ensureView();
  contents.emit('did-navigate', {}, url, 200);
  contents.emit('did-finish-load');
  assert.equal(panel.snapshot().status, 'ready');
  contents.emit('did-start-loading');
  contents.emit('did-start-navigation', {}, url + 'iframe', false, false);
  contents.emit('did-start-navigation', {}, url + '#maps', true, true);
  assert.equal(panel.snapshot().status, 'ready');
  contents.emit('did-start-navigation', {}, url + 'maps', false, true);
  assert.equal(panel.snapshot().status, 'loading');
  contents.emit('did-navigate', {}, url + 'maps', 200);
  contents.emit('did-finish-load');
  assert.equal(panel.snapshot().status, 'ready');
  panel.destroy();
});

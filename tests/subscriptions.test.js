const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../core/library');
const { Downloads } = require('../core/downloads');
const { Community, parseBrowse } = require('../core/community');
const { Workshop } = require('../core/workshop');
const { unsubscribeAndUninstall } = require('../core/subscriptions');
const { vpk, game } = require('./fixtures.cjs');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-subscriptions-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }

test('unsubscribe removes every exact project addon copy while preserving other projects and Steam cache', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), cache = path.join(root, 'steamapps/workshop/content/550/123');
  fs.mkdirSync(path.join(addons, 'workshop')); fs.mkdirSync(cache, { recursive: true });
  for (const file of [path.join(addons, 'safehouse-workshop-123.vpk'), path.join(addons, 'safehouse-workshop-123-2.vpk'), path.join(addons, 'workshop/123.vpk'), path.join(addons, 'safehouse-workshop-1234.vpk'), path.join(addons, 'local.vpk'), path.join(cache, 'cached.vpk')]) fs.writeFileSync(file, vpk({ 'maps/test.bsp': 'map' }));
  const library = new Library({ gameRoot, steamRoots: [root] }), downloads = new Downloads({ stateDir: path.join(root, 'profile'), library });
  downloads.trackWorkshop('123', 'Temporary project');
  let unsubscribed = false;
  const result = await unsubscribeAndUninstall({ id: '123', workshop: { unsubscribe: async id => { unsubscribed = true; return { id, subscribed: false }; } }, downloads, library, trash: async file => { assert.ok(unsubscribed); fs.rmSync(file); } });
  assert.equal(result.removed.length, 3);
  assert.ok(fs.existsSync(path.join(addons, 'safehouse-workshop-1234.vpk')));
  assert.ok(fs.existsSync(path.join(addons, 'local.vpk')));
  assert.ok(fs.existsSync(path.join(cache, 'cached.vpk')));
  assert.equal(downloads.list()[0].status, 'cancelled');
});

test('local preservation skips addon removal after Steam unsubscribe', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), file = path.join(addons, 'safehouse-workshop-123.vpk');
  fs.writeFileSync(file, vpk({ 'maps/test.bsp': 'map' }));
  const library = new Library({ gameRoot }), downloads = new Downloads({ stateDir: path.join(root, 'state'), library });
  let unsubscribed = false;
  const result = await unsubscribeAndUninstall({ id: '123', workshop: { unsubscribe: async id => { unsubscribed = true; return { id, subscribed: false }; } }, downloads, library, preserveLocal: true, trash: async () => { throw new Error('must not delete'); } });
  assert.equal(unsubscribed, true); assert.equal(result.preserved, true); assert.deepEqual(result.removed, []); assert.ok(fs.existsSync(file));
});

test('failed Steam unsubscribe leaves installed files and queued downloads untouched', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), file = path.join(addons, 'safehouse-workshop-123.vpk');
  fs.writeFileSync(file, vpk({ 'maps/test.bsp': 'map' }));
  const library = new Library({ gameRoot }), downloads = new Downloads({ stateDir: path.join(root, 'profile'), library }); downloads.trackWorkshop('123', 'Temporary project');
  await assert.rejects(unsubscribeAndUninstall({ id: '123', workshop: { unsubscribe: async () => { throw new Error('offline'); } }, downloads, library, trash: async () => { throw new Error('must not delete'); } }), /offline/);
  assert.ok(fs.existsSync(file)); assert.equal(downloads.list()[0].status, 'steam');
});

test('unsubscribe aborts an in-flight copy, cancels queued copies and prevents later installation', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), file = path.join(root, 'legacy.bin');
  fs.writeFileSync(file, vpk({ 'maps/test.bsp': 'temporary map' })); fs.appendFileSync(file, Buffer.alloc(8 * 1024 * 1024));
  const library = new Library({ gameRoot }), downloads = new Downloads({ stateDir: path.join(root, 'profile'), library });
  downloads.trackWorkshop('123', 'Temporary project'); downloads.installWorkshop('123', file);
  assert.ok(downloads.active); const id = downloads.active.id;
  downloads.jobs.push({ id: 'duplicate-queued', kind: 'workshop', workshopId: '123', status: 'queued', input: file, addonDir: addons });
  await downloads.stopWorkshop('123');
  assert.equal(downloads.active, null); assert.equal(downloads.list().find(job => job.id === id).status, 'cancelled');
  assert.equal(downloads.list().find(job => job.id === 'duplicate-queued').status, 'cancelled');
  assert.equal(fs.readdirSync(addons).length, 0);
});

test('partial uninstall failure reports the completed unsubscribe and keeps the failed file', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), file = path.join(addons, 'safehouse-workshop-123.vpk'); fs.writeFileSync(file, vpk({ 'maps/test.bsp': 'map' }));
  const library = new Library({ gameRoot }), downloads = new Downloads({ stateDir: path.join(root, 'profile'), library });
  await assert.rejects(unsubscribeAndUninstall({ id: '123', workshop: { unsubscribe: async id => ({ id, subscribed: false }) }, downloads, library, trash: async () => { throw new Error('file locked'); } }), /已取消订阅，但本地卸载未完成.*file locked/);
  assert.ok(fs.existsSync(file));
});

test('workshop secondary filters reach both public browsing and native Steam with correct AND/OR semantics', async () => {
  let requested, native;
  const community = new Community({ session: { fetch: async url => { requested = new URL(url); return new Response('<div class="workshopBrowseItems"></div>'); } } });
  await community.search('', 2, 'survivor', 'nick'); assert.deepEqual(requested.searchParams.getAll('requiredtags[]'), ['Survivors', 'Nick']);
  await community.search('', 1, 'weapon', 'shotgun'); assert.deepEqual(requested.searchParams.getAll('requiredtags[]'), ['Weapons', 'Shotgun']);
  await community.search('', 1, 'infected', 'tank'); assert.deepEqual(requested.searchParams.getAll('requiredtags[]'), ['Tank']);
  await assert.rejects(community.search('', 1, 'weapon', 'nick'), /细分类/);
  const workshop = new Workshop({ init: () => ({ apps: { isSubscribedApp: () => true }, workshop: { getAllItems: async (...args) => { native = args[5]; return { items: [], totalResults: 0 }; } } }) });
  await workshop.search('', 1, 'weapon', 'rifle'); assert.deepEqual(native.requiredTags, ['Weapons', 'Rifle']); assert.equal(native.matchAnyTag, false);
  await workshop.search('', 1, 'infected'); assert.deepEqual(native.requiredTags, ['Common Infected', 'Special Infected']); assert.equal(native.matchAnyTag, true);
});

test('modern browse reads only the selected query results and retains true pagination and tags', () => {
  const data = { renderContext: { queryData: JSON.stringify({ queries: [{ queryKey: ['workshop_browse', { appid: 550 }], state: { data: { current_page: 2, total_pages: 4, results: [{ publishedfileid: '123', consumer_appid: 550, title: 'Shotgun', creator: '1', tags: [{ tag: 'Shotgun' }] }] } } }] }) } };
  const html = `<script id="valve-ssr-data">${JSON.stringify(data)}</script><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=999"><img alt="unrelated recommended mod"></a>`;
  const result = parseBrowse(html); assert.equal(result.page, 2); assert.equal(result.hasMore, true); assert.deepEqual(result.items.map(item => item.id), ['123']); assert.deepEqual(result.items[0].tags, ['Shotgun']);
});

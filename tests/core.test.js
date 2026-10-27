const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { Library, discover } = require('../core/library');
const { parseVdf, stringifyVdf } = require('../core/valve');
const { readVpk } = require('../core/vpk');
const { Downloads, unpackZip } = require('../core/downloads');
const { parseSearch, workshopId, Community, Translator } = require('../core/community');
const { readLocalSteamState } = require('../core/steam');
const { vpk, game } = require('./fixtures.cjs');

function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-core-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
async function waitJob(queue, id) { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const job = queue.list().find(item => item.id === id); if (['completed', 'failed', 'cancelled'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('安装任务超时'); }
async function zip(file, files) { const archive = new yazl.ZipFile(); for (const [name, data] of Object.entries(files)) archive.addBuffer(data, name); const writing = pipeline(archive.outputStream, fs.createWriteStream(file)); archive.end(); await writing; }

test('Valve KeyValues retains workshop paths and rejects incomplete objects', () => {
  const input = { AddonList: { 'workshop\\123.vpk': '0', '中文 地图.vpk': '1' } };
  assert.deepEqual(parseVdf('// comment\n' + stringifyVdf(input)), input);
  assert.throws(() => parseVdf('"AddonList" { "x" "1"'));
});
test('Steam library and ACF discovery finds a valid app 550 installation', t => {
  const root = fixture(t), { gameRoot } = game(root);
  assert.deepEqual(discover({ roots: [root], registry: false }).games, [gameRoot]);
});
test('VPK concrete map resources take priority; explicit metadata remains a fallback and unsafe packages reject', t => {
  const root = fixture(t), file = path.join(root, 'map.vpk');
  fs.writeFileSync(file, vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "测试地图" }', 'maps/test.bsp': 'map' }));
  assert.equal(readVpk(file).title, '测试地图'); assert.equal(readVpk(file).type, 'map');
  fs.writeFileSync(file, vpk({ 'addoninfo.txt': '"AddonInfo" { "addontype" "Weapon" }', 'maps/test.bsp': 'weapon' }));
  assert.equal(readVpk(file).type, 'map');
  fs.writeFileSync(file, vpk({ 'addoninfo.txt': '"AddonInfo" { "category" "Survivor" }', 'sound/test.wav': 'survivor' }));
  assert.equal(readVpk(file).type, 'survivor');
  fs.writeFileSync(file, vpk({ 'addoninfo.txt': '"AddonInfo" { "type" "Sound" }', 'models/test.mdl': 'sound' }));
  assert.equal(readVpk(file).type, 'sound');
  fs.writeFileSync(file, vpk({ 'models/survivors/test.mdl': 'fallback' }));
  assert.equal(readVpk(file).type, 'survivor');
  fs.writeFileSync(file, vpk({ 'bin/evil.dll': 'code' })); assert.throws(() => readVpk(file, { install: true }), /可执行/);
  fs.writeFileSync(file, Buffer.from('broken')); assert.throws(() => readVpk(file));
});
test('enable/disable edits the real game addonlist path without conflict state', t => {
  const root = fixture(t), { gameRoot, addons } = game(root);
  fs.writeFileSync(path.join(addons, 'one.vpk'), vpk({ 'materials/shared.vmt': 'one' }));
  fs.writeFileSync(path.join(addons, 'two.vpk'), vpk({ 'materials/shared.vmt': 'two' }));
  const library = new Library({ gameRoot }), baseline = library.scan();
  assert.equal(Object.hasOwn(baseline, 'conflicts'), false);
  assert.equal(baseline.items.filter(item => item.enabled).length, 2);
  const modified = library.setEnabled([baseline.items[0].id], false);
  assert.equal(Object.hasOwn(modified, 'conflicts'), false); assert.equal(modified.items.filter(item => item.enabled).length, 1);
  assert.ok(fs.existsSync(path.join(gameRoot, 'left4dead2', 'addonlist.txt')));
  assert.ok(!fs.existsSync(path.join(addons, 'addonlist.txt')));
  const restored = library.setEnabled([baseline.items[0].id], true); assert.equal(restored.items.filter(item => item.enabled).length, 2);
});
test('batch preflight rejects unknown IDs without changing addonlist', t => {
  const root = fixture(t), { gameRoot, addons } = game(root); fs.writeFileSync(path.join(addons, 'one.vpk'), vpk({ 'maps/a.bsp': 'a' }));
  const library = new Library({ gameRoot }), item = library.scan().items[0];
  assert.throws(() => library.setEnabled([item.id, 'missing'], false)); assert.ok(!fs.existsSync(path.join(gameRoot, 'left4dead2', 'addonlist.txt')));
});
test('local queue installs a VPK, refuses collisions and survives recreation', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), file = path.join(root, 'example.vpk'); fs.writeFileSync(file, vpk({ 'maps/new.bsp': 'bsp' }));
  const options = { stateDir: path.join(root, 'state'), library: new Library({ gameRoot }) }, queue = new Downloads(options);
  const first = queue.enqueue([file])[0]; assert.equal((await waitJob(queue, first.id)).status, 'completed');
  assert.deepEqual(fs.readFileSync(path.join(addons, 'example.vpk')), fs.readFileSync(file));
  const again = queue.enqueue([file])[0]; assert.equal((await waitJob(queue, again.id)).status, 'failed');
  assert.match(queue.list()[0].error, /同名/); assert.equal(new Downloads(options).list().length, 2);
});
test('ZIP installs atomically: one colliding filename prevents every package', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), file = path.join(root, 'maps.zip');
  const data = vpk({ 'maps/a.bsp': 'a' }); fs.writeFileSync(path.join(addons, 'two.vpk'), data);
  await zip(file, { 'sub/one.vpk': data, 'two.vpk': data });
  const queue = new Downloads({ stateDir: path.join(root, 'state'), library: new Library({ gameRoot }) });
  const job = queue.enqueue([file])[0]; assert.equal((await waitJob(queue, job.id)).status, 'failed');
  assert.ok(!fs.existsSync(path.join(addons, 'one.vpk'))); assert.deepEqual(fs.readdirSync(addons), ['two.vpk']);
});
test('ZIP rejects duplicate output names and an already cancelled extraction', async t => {
  const root = fixture(t), file = path.join(root, 'maps.zip'), target = path.join(root, 'extract'); fs.mkdirSync(target);
  await zip(file, { 'a/same.vpk': vpk({ 'maps/a.bsp': 'a' }), 'b/same.vpk': vpk({ 'maps/b.bsp': 'b' }) });
  await assert.rejects(unpackZip(file, target, new AbortController().signal), /同名/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(unpackZip(file, target, controller.signal), /取消/);
});
test('a Steam download completes only when a valid installed file is observed', t => {
  const root = fixture(t), { gameRoot } = game(root), queue = new Downloads({ stateDir: path.join(root, 'state'), library: new Library({ gameRoot }) });
  queue.trackWorkshop('123', 'Map'); queue.syncWorkshop([{ workshopId: '123', source: 'cache', size: 15 }]); assert.equal(queue.list()[0].status, 'steam');
  queue.syncWorkshop([{ workshopId: '123', source: 'workshop', size: 15 }]); assert.equal(queue.list()[0].status, 'completed');
});
test('community identities remain attached to their own preview links', () => {
  const html = '<div class="workshopItem"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=123"><img alt="First" src="https://images.steamusercontent.com/1"></a><div class="workshopItemTitle">First</div></div><a href="https://evil.example/sharedfiles/filedetails/?id=456"><img alt="Wrong"></a>';
  const items = parseSearch(html); assert.equal(items.length, 1); assert.equal(items[0].id, '123');
  assert.equal(workshopId('https://steamcommunity.com/sharedfiles/filedetails/?id=123'), '123');
  assert.throws(() => workshopId('https://steamcommunity.com.evil.example/sharedfiles/filedetails/?id=1'));
});
test('local Steam state reads the most recent account without web login', t => {
  const root = fixture(t), config = path.join(root, 'config'); fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, 'loginusers.vdf'), stringifyVdf({ users: {
    '76561190000000001': { AccountName: 'older', PersonaName: 'Older', MostRecent: '0', Timestamp: '10' },
    '76561190000000002': { AccountName: 'newer', PersonaName: 'Newer', MostRecent: '1', Timestamp: '20' },
  } }));
  const state = readLocalSteamState({ roots: [root], running: () => false });
  assert.equal(state.available, true); assert.equal(state.running, false); assert.equal(state.account.steamId, '76561190000000002'); assert.equal(state.account.name, 'Newer');
  assert.equal(state.accounts.length, 2);
});
test('workshop categories add Steam requiredtags filters', async () => {
  let requested;
  const community = new Community({ session: { fetch: async url => { requested = new URL(url); return new Response('<div class="workshopBrowseItems"></div>'); } } });
  const result = await community.search('', 2, 'weapon');
  assert.deepEqual(result, { items: [], page: 2, hasMore: false });
  assert.deepEqual(requested.searchParams.getAll('requiredtags[]'), ['Weapons']);
});

test('modern Steam browse cards parse preview alt text and empty SSR is a valid result', async () => {
  const html = '<div><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=123"><img alt="Modern Mod" src="https://images.steamusercontent.com/1"></a></div>';
  assert.equal(parseSearch(html)[0].title, 'Modern Mod');
  const data = { route: '/workshop/browse', loaderData: [JSON.stringify({ serverQuery: { appid: 550 } })] };
  const community = new Community({ session: { fetch: async () => new Response(`<script id="valve-ssr-data" type="application/json">${JSON.stringify(data)}</script>`) } });
  assert.deepEqual((await community.search('no results')).items, []);
});

test('legacy Steam binary is validated and installed as VPK; repeated installs do not duplicate files', async t => {
  const root = fixture(t), { gameRoot, addons } = game(root), source = path.join(root, '123_legacy.bin');
  fs.writeFileSync(source, vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Workshop Fixture" }', 'maps/test.bsp': 'map' }));
  const library = new Library({ gameRoot }), queue = new Downloads({ stateDir: path.join(root, 'state'), library });
  queue.trackWorkshop('123', 'Workshop'); queue.installWorkshop('123', source);
  assert.equal((await waitJob(queue, queue.list()[0].id)).status, 'completed');
  assert.equal(library.scan().items[0].workshopId, '123');
  assert.ok(fs.existsSync(path.join(addons, 'safehouse-workshop-123.vpk')));
  queue.trackWorkshop('123', 'Workshop'); queue.installWorkshop('123', source);
  assert.equal((await waitJob(queue, queue.list()[0].id)).status, 'completed');
  assert.equal(fs.readdirSync(addons).length, 1);
  const bad = path.join(root, 'bad.bin'); fs.writeFileSync(bad, 'not a vpk');
  queue.trackWorkshop('456', 'Bad'); queue.installWorkshop('456', bad);
  assert.equal(queue.list()[0].status, 'failed'); assert.equal(fs.readdirSync(addons).length, 1);
});

test('UGC rejects a foreign app before subscribing and passes Steam byte progress without guessing', async () => {
  const { Workshop } = require('../core/workshop');
  let subscribed = false, appId = 999, downloaded = false;
  const client = { apps: { isSubscribedApp: () => true }, workshop: {
    getItem: async id => ({ publishedFileId: id, consumerAppId: appId, title: 'Fixture', description: '', owner: { steamId64: 1n }, tags: [] }),
    subscribe: async () => { subscribed = true; }, unsubscribe: async () => { subscribed = false; }, download: () => { downloaded = true; return true; },
    state: () => 16 | 32, getSubscribedItems: () => subscribed ? [123n] : [], downloadInfo: () => ({ current: 125n, total: 1000n }), installInfo: () => null,
  } };
  const workshop = new Workshop({ init: () => client });
  await assert.rejects(workshop.subscribe('123'), /不是求生之路/); assert.equal(subscribed, false);
  appId = 550; await workshop.subscribe('123'); assert.equal(downloaded, true);
  const progress = workshop.snapshot('123'); assert.equal(progress.bytes, 125); assert.equal(progress.total, 1000); assert.equal(progress.installed, false); assert.equal(progress.subscribed, true);
  await workshop.unsubscribe('123'); assert.equal(subscribed, false);
});
test('translation caches the result by language and never fabricates a failed result', async t => {
  const root = fixture(t); let calls = 0;
  const translator = new Translator({ file: path.join(root, 'cache.json'), fetch: async () => { calls++; return new Response(JSON.stringify([[['测试', 'test']], null, 'en'])); } });
  assert.equal((await translator.translate('test', 'zh-CN')).text, '测试'); await translator.translate('test', 'zh-CN'); assert.equal(calls, 1);
  translator.fetch = async () => new Response('', { status: 503 }); await assert.rejects(translator.translate('another', 'zh-CN'), /503/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const yazl = require('yazl');
const { Library } = require('../core/library');
const { Downloads } = require('../core/downloads');
const { PanelDownloads, filename, downloadUrl, isProviderUrl, LIMIT } = require('../core/panel-downloads');
const { CenterConsole, panelZoom } = require('../core/console');
const { game, vpk } = require('./fixtures.cjs');

const data = vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Panel fixture" }', 'maps/panel.bsp': 'fixture' });
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('fixture operation timed out');
}
async function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-panel-')), { gameRoot, addons } = game(root);
  const downloads = new Downloads({ stateDir: path.join(root, 'profile'), library: new Library({ gameRoot }) });
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/redirect')) { response.writeHead(302, { Location: '/valid' }); response.end(); return; }
    if (request.url === '/outside') { response.writeHead(302, { Location: 'https://outside.invalid/file.vpk?secret=hidden' }); response.end(); return; }
    if (request.url === '/error') { response.writeHead(403); response.end('expired'); return; }
    if (request.url === '/mismatch') { response.setHeader('Content-Length', data.length + 1); response.end(data); return; }
    if (request.url === '/html') { response.end('<html>expired link</html>'); return; }
    if (request.url === '/short') { response.write(data.subarray(0, 5)); response.end(); return; }
    if (request.url === '/slow' || request.url === '/timeout') { response.writeHead(200); response.write(data.subarray(0, 4)); return; }
    response.setHeader('Content-Length', data.length); response.end(data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const panel = new PanelDownloads({ directory: path.join(root, 'files'), downloads, fetch, ...options });
  t.after(async () => { panel.close(); await until(() => !panel.active.size && !downloads.active); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); });
  const start = (route = 'valid', name = '地图.vpk', size = data.length) => panel.start({ url: url + route, name, size }, url);
  const finished = async id => { await until(() => !panel.active.has(id)); return downloads.jobs.find(job => job.id === id); };
  return { root, addons, downloads, panel, start, finished, url };
}

test('panel layout uses bounded automatic zoom and accepts only supported manual scales', () => {
  assert.equal(panelZoom(400), 0.7); assert.equal(panelZoom(1360), 1); assert.equal(panelZoom(3000), 1);
  assert.equal(panelZoom(1088), 0.8); assert.equal(panelZoom(400, 1.25), 1.25);
  for (const mode of [0, 0.5, 2, '1', null]) assert.throws(() => panelZoom(1200, mode));
});
test('download bridge accepts only the current panel main frame and two narrow actions', async () => {
  const sender = {}, main = { url: 'https://panel.example/maps' }; main.top = main;
  let started = 0;
  const panel = Object.create(CenterConsole.prototype); Object.assign(panel, { view: { webContents: sender }, url: 'https://panel.example/', directDownloads: { start: () => { started++; return { id: 'fixture' }; } } });
  const event = { sender, senderFrame: main };
  assert.equal((await panel.helperRequest(event, { action: 'status' })).native, true);
  assert.equal((await panel.helperRequest(event, { action: 'download' })).id, 'fixture'); assert.equal(started, 1);
  for (const invalid of [{ sender: {}, senderFrame: main }, { sender }, { sender, senderFrame: { url: main.url, top: main } }, { sender, senderFrame: Object.assign({ top: null }, { url: 'https://other.example/' }) }]) await assert.rejects(panel.helperRequest(invalid, { action: 'status' }), /来源/);
  for (const action of ['install', 'reveal', 'import', 'run']) await assert.rejects(panel.helperRequest(event, { action }), /无效/);
});
test('download URLs, names and sizes reject unrelated hosts, credentials and filesystem paths', async t => {
  for (const name of ['../map.vpk', 'C:\\map.vpk', 'NUL.vpk', 'a.exe', 'map.vpk\u0000']) assert.throws(() => filename(name));
  assert.equal(filename('中文地图.zip'), '中文地图.zip');
  assert.ok(isProviderUrl('https://d.pcs.baidu.com/file')); assert.ok(isProviderUrl('https://d.baidupcs.com/file'));
  for (const url of ['https://baidupcs.com.evil.invalid/file', 'http://baidupcs.com/file', 'https://u:p@baidupcs.com/file', 'https://baidupcs.com:444/file']) assert.ok(!isProviderUrl(url));
  for (const url of ['file:///map.vpk', 'https://elsewhere.invalid/map.vpk', 'http://u:p@localhost/map.vpk']) assert.throws(() => downloadUrl(url, 'http://localhost/'));
  const fixture = await setup(t);
  for (const size of [0, NaN, '10', LIMIT + 1]) assert.throws(() => fixture.start('valid', 'map.vpk', size));
  assert.equal(fixture.downloads.jobs.length, 0);
});
test('real streaming VPK download, safe filename collision, install and history clearing preserve files', async t => {
  const f = await setup(t); fs.writeFileSync(path.join(f.panel.directory, '地图.vpk'), 'existing');
  const { id } = await f.start('redirect?token=never-persist'); const job = await f.finished(id);
  assert.equal(job.status, 'downloaded'); assert.equal(job.bytes, data.length); assert.equal(path.basename(job.input), '地图 (1).vpk');
  assert.deepEqual(fs.readFileSync(f.panel.file(id)), data); assert.equal(fs.readFileSync(path.join(f.panel.directory, '地图.vpk'), 'utf8'), 'existing');
  assert.ok(!fs.readFileSync(f.downloads.store, 'utf8').includes('never-persist'));
  assert.deepEqual(fs.readdirSync(f.panel.directory).sort(), ['地图 (1).vpk', '地图.vpk']);
  const install = f.panel.install(id).find(job => job.kind === 'import');
  await until(() => f.downloads.jobs.find(job => job.id === install.id)?.status === 'completed');
  assert.deepEqual(fs.readFileSync(path.join(f.addons, '地图 (1).vpk')), data);
  f.downloads.clear(); assert.equal(f.downloads.jobs.length, 0); assert.ok(fs.existsSync(job.input));
});
test('ZIP direct downloads use the existing validated installation queue', async t => {
  const archive = new yazl.ZipFile(); archive.addBuffer(data, 'folder/zip-map.vpk'); archive.end();
  const chunks = []; for await (const chunk of archive.outputStream) chunks.push(chunk); const zip = Buffer.concat(chunks);
  const f = await setup(t, { fetch: async () => new Response(zip, { headers: { 'Content-Length': String(zip.length) } }) });
  const { id } = await f.start('valid', 'maps.zip', zip.length); assert.equal((await f.finished(id)).status, 'downloaded');
  const install = f.panel.install(id).find(job => job.kind === 'import');
  await until(() => f.downloads.jobs.find(job => job.id === install.id)?.status === 'completed');
  assert.deepEqual(fs.readFileSync(path.join(f.addons, 'zip-map.vpk')), data);
});
test('expired links, HTML, wrong lengths, truncated files and external redirects leave no finished files', async t => {
  const f = await setup(t);
  for (const route of ['error', 'html', 'mismatch', 'short', 'outside']) {
    let result; try { result = await f.start(route); } catch {}
    await until(() => !f.panel.active.size); const job = result ? f.downloads.jobs.find(job => job.id === result.id) : f.downloads.jobs[0];
    assert.equal(job.status, 'failed', route); assert.ok(!fs.existsSync(job.input), route); assert.ok(!job.error.includes('secret='));
    assert.throws(() => f.panel.file(job.id));
  }
  assert.deepEqual(fs.readdirSync(f.panel.directory), []);
});
test('cancelling a real slow stream removes partials; two parallel tasks and duplicates are bounded', async t => {
  const f = await setup(t), first = await f.start('slow', 'one.vpk');
  assert.throws(() => f.start('slow', 'duplicate.vpk'), /已在/);
  const second = await f.start('timeout', 'two.vpk'); assert.throws(() => f.start('valid'), /两项/);
  f.panel.cancel(first.id); f.panel.cancel(second.id);
  assert.equal((await f.finished(first.id)).status, 'cancelled'); assert.equal((await f.finished(second.id)).status, 'cancelled');
  assert.deepEqual(fs.readdirSync(f.panel.directory), []); assert.deepEqual(fs.readdirSync(f.addons), []);
});
test('idle download aborts with a retryable failure instead of hanging', async t => {
  const f = await setup(t, { idleTimeout: 100 }); const { id } = await f.start('timeout');
  const job = await f.finished(id); assert.equal(job.status, 'failed'); assert.match(job.error, /超时/); assert.deepEqual(fs.readdirSync(f.panel.directory), []);
});
test('provider requests set the required User-Agent and validate redirect destinations', async t => {
  const calls = [], f = await setup(t, { fetch: async (url, options) => { calls.push([url, options.headers]); return calls.length === 1 ? new Response(null, { status: 302, headers: { Location: 'https://other.baidupcs.com/map?token=private' } }) : new Response(data); } });
  const { id } = await f.panel.start({ name: 'cloud.vpk', size: data.length, url: 'https://d.baidupcs.com/map?token=private' }, f.url);
  assert.equal((await f.finished(id)).status, 'downloaded'); assert.equal(calls.length, 2); assert.ok(calls.every(([, headers]) => headers['User-Agent'] === 'pan.baidu.com'));
  assert.ok(!fs.readFileSync(f.downloads.store, 'utf8').includes('private'));
});
test('restart marks interrupted panel tasks failed and removes their stale partial files', async t => {
  const f = await setup(t), id = require('node:crypto').randomUUID();
  f.downloads.jobs.push({ id, kind: 'panel', status: 'downloading', title: 'old.vpk', input: path.join(f.panel.directory, 'old.vpk') }); f.downloads.save();
  fs.writeFileSync(f.panel.partial(id), data.subarray(0, 4));
  const restored = new Downloads({ stateDir: f.downloads.stateDir, library: f.downloads.library });
  new PanelDownloads({ directory: f.panel.directory, downloads: restored, fetch });
  assert.equal(restored.jobs[0].status, 'failed'); assert.match(restored.jobs[0].error, /中断/); assert.ok(!fs.existsSync(f.panel.partial(id)));
});

test('single failed-download cleanup removes residual files and its record but preserves installed and unrelated files', async t => {
  const f = await setup(t); const { id } = await f.start('short'); const job = await f.finished(id);
  assert.equal(job.status, 'failed');
  fs.writeFileSync(job.input, data.subarray(0, 9)); fs.writeFileSync(f.panel.partial(id), data.subarray(0, 4));
  const installed = path.join(f.addons, path.basename(job.input)), unrelated = path.join(f.panel.directory, 'keep.vpk');
  fs.writeFileSync(installed, data); fs.writeFileSync(unrelated, data);
  const trash = path.join(f.root, 'recycle-bin'); fs.mkdirSync(trash); const moved = [];
  await f.panel.remove(id, async file => { moved.push(file); fs.renameSync(file, path.join(trash, path.basename(file))); });
  assert.equal(moved.length, 2); assert.equal(f.downloads.jobs.some(item => item.id === id), false);
  assert.ok(!fs.existsSync(job.input)); assert.ok(!fs.existsSync(f.panel.partial(id)));
  assert.deepEqual(fs.readFileSync(installed), data); assert.deepEqual(fs.readFileSync(unrelated), data);
});

test('cleanup rejects active, completed or out-of-directory downloads and retains history on recycle-bin failure', async t => {
  const f = await setup(t); const active = await f.start('slow');
  await assert.rejects(f.panel.remove(active.id, async () => { throw new Error('must not trash'); }), /失败或已取消/);
  f.panel.cancel(active.id); const job = await f.finished(active.id);
  fs.writeFileSync(job.input, data);
  await assert.rejects(f.panel.remove(job.id, async () => { throw new Error('locked'); }), /记录已保留.*locked/);
  assert.ok(f.downloads.jobs.includes(job)); assert.ok(fs.existsSync(job.input));
  const outside = path.join(f.root, 'outside.vpk'); fs.writeFileSync(outside, data); job.input = outside;
  await assert.rejects(f.panel.remove(job.id, async () => fs.rmSync(outside)), /不在客户端下载目录/);
  assert.ok(fs.existsSync(outside));
  job.status = 'downloaded'; await assert.rejects(f.panel.remove(job.id, async () => {}), /失败或已取消/);
});

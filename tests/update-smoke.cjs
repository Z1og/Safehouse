const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { runtime } = require('../scripts/runtime.cjs');
const { game } = require('./fixtures.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-update-smoke-'));
  const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const { gameRoot } = game(root);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: false }));
  // Download-only bytes: never execute this fixture as a program.
  const payload = crypto.randomBytes(4 * 1024 * 1024), digest = crypto.createHash('sha512').update(payload).digest('base64');
  let feedVersion = '0.1.15', broken = false, offline = false, downloads = 0, application;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/latest.yml')) {
      if (offline) { res.writeHead(503); res.end(); return; }
      res.setHeader('Content-Type', 'text/yaml');
      res.end(JSON.stringify({ version: feedVersion, files: [{ url: 'fixture.exe', sha512: broken ? Buffer.alloc(64).toString('base64') : digest, size: payload.length }], path: 'fixture.exe', sha512: digest, releaseNotes: '<img src=x onerror="window.fixtureInjection=1"> Fixture release notes' })); return;
    }
    if (req.url.startsWith('/fixture.exe')) {
      downloads++; res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length });
      let sent = 0; const interval = setInterval(() => {
        const end = Math.min(sent + 65536, payload.length); res.write(payload.subarray(sent, end)); sent = end;
        if (sent === payload.length) { clearInterval(interval); res.end(); }
      }, 35); res.once('close', () => clearInterval(interval)); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`, errors = [];
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env });
    const page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await application.evaluate(() => {
      const { Updates } = process.mainModule.require('./core/updates'), { Downloads } = process.mainModule.require('./core/downloads');
      const snapshot = Updates.prototype.snapshot, list = Downloads.prototype.list;
      Updates.prototype.snapshot = function () { globalThis.fixtureUpdates = this; return snapshot.call(this); };
      Downloads.prototype.list = function (...args) { globalThis.fixtureDownloads = this; return list.apply(this, args); };
    });
    await page.evaluate(() => window.safehouse.state());
    await application.evaluate(({ app }, { root, url }) => {
      const fs = process.mainModule.require('node:fs'), path = process.mainModule.require('node:path');
      const { NsisUpdater } = process.mainModule.require(path.join(app.getAppPath(), 'node_modules/electron-updater')), { Updates } = process.mainModule.require('./core/updates');
      const engine = new NsisUpdater({ provider: 'generic', url }); engine.forceDevUpdateConfig = true;
      const config = path.join(root, 'update.yml'); fs.writeFileSync(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: safehouse-test-${path.basename(root)}\n`); engine.updateConfigPath = config;
      const original = globalThis.fixtureUpdates, replacement = new Updates({ engine, version: app.getVersion(), mode: original.state.mode === 'development' ? 'installed' : original.state.mode, changed: original.changed });
      for (const key of ['snapshot', 'check', 'download', 'cancel', 'install', 'close']) original[key] = replacement[key].bind(replacement);
      globalThis.fixtureUpdateEngine = engine; globalThis.fixtureUpdateController = replacement;
      globalThis.fixtureProgress = []; engine.on('download-progress', value => globalThis.fixtureProgress.push(value.percent));
      globalThis.fixtureInstalls = 0; engine.quitAndInstall = () => { globalThis.fixtureInstalls++; };
      globalThis.fixtureCache = path.join(process.env.LOCALAPPDATA, `safehouse-test-${path.basename(root)}`);
      replacement.set({});
    }, { root, url });
    await page.locator('.nav[data-page="settings"]').click();
    const status = expected => page.locator(`#app-update-status[data-status="${expected}"]`).waitFor();
    const click = action => page.locator(`[data-action="update-${action}"]`).click();
    await click('check'); await status('latest'); assert.equal(downloads, 0);
    offline = true; await click('check'); await status('error');
    offline = false; feedVersion = '0.1.16'; broken = true;
    await click('check'); await status('available'); assert.equal(downloads, 0);
    assert.equal(await page.locator('.app-update-notes img').count(), 0);
    assert.ok((await page.locator('.app-update-notes pre').textContent()).includes('<img'));
    console.log('PASS real NsisUpdater checks: latest, offline error, retry, update metadata and escaped release notes; no automatic download');
    await click('download'); await status('downloading');
    await page.locator('[data-page="favorites"]').click(); await page.getByRole('heading', { name: '我的收藏', exact: true }).waitFor();
    await page.locator('.nav[data-page="settings"]').click(); await click('cancel'); await status('available');
    await application.evaluate(async () => { await globalThis.fixtureUpdateController.downloading; });
    await click('download'); await status('error');
    assert.match(await page.locator('#app-update-status').textContent(), /校验失败/);
    assert.equal((await page.evaluate(() => window.safehouse.updateInstall())).ok, false);
    assert.equal(await application.evaluate(() => globalThis.fixtureInstalls), 0);
    broken = false; await click('check'); await status('available'); await click('download'); await status('downloaded');
    assert.ok(await application.evaluate(() => globalThis.fixtureProgress.some(value => value > 0 && value < 100)));
    console.log('PASS real download: navigation stays responsive, cancellation works, SHA-512 failure blocks install and retry completes with real progress');
    await application.evaluate(() => globalThis.fixtureDownloads.jobs.push({ id: 'fixture-active', kind: 'workshop', status: 'downloading' }));
    const blocked = await page.evaluate(() => window.safehouse.updateInstall()); assert.equal(blocked.ok, false); assert.match(blocked.error, /模组/);
    await application.evaluate(() => { globalThis.fixtureDownloads.jobs = globalThis.fixtureDownloads.jobs.filter(value => value.id !== 'fixture-active'); });
    const output = path.join(__dirname, '../output/playwright'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'updates-desktop.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 700));
    await page.screenshot({ path: path.join(output, 'updates-compact.png') });
    assert.equal(await page.evaluate(() => document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth), false);
    await click('install'); await status('installing'); assert.equal(await application.evaluate(() => globalThis.fixtureInstalls), 1);
    assert.deepEqual(errors, []); assert.deepEqual(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8').includes(gameRoot.replaceAll('\\', '\\\\')), true);
    console.log('PASS IPC install guard, explicit install action, 980px settings layout and renderer errors; fixture executable never runs');
    const cache = await application.evaluate(() => globalThis.fixtureCache);
    await application.close(); application = null;
    if (path.basename(cache).startsWith('safehouse-test-safehouse-update-smoke-')) fs.rmSync(cache, { recursive: true, force: true });
  } finally {
    if (application) await application.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

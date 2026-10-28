// Real per-user NSIS installation and upgrade, with a different executable,
// application ID, shortcuts, profile and updater cache from the user's app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { build, Platform } = require('electron-builder');
const { chromium } = require('playwright-core');
const { installerConfiguration } = require('../scripts/installer.cjs');
const { copyTree } = require('../scripts/runtime.cjs');
const { game, vpk } = require('./fixtures.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(file, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => { child.kill(); reject(Error('Isolated installer timed out')); }, 180000);
    child.on('error', reject); child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error(`Isolated installer exit ${code}`)); });
  });
}
(async () => {
  if (process.platform !== 'win32') throw Error('Windows-only installation test');
  const source = process.env.SAFEHOUSE_INSTALLER_APP;
  if (!source || !fs.existsSync(path.join(source, 'resources/app.asar'))) throw Error('Set SAFEHOUSE_INSTALLER_APP to the packaged app directory');
  const parent = path.join(process.env.LOCALAPPDATA, 'Safehouse', 'integration-tests'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'installer-')), output = path.join(root, 'output'), profile = path.join(root, 'profile');
  fs.mkdirSync(profile); const { gameRoot, addons } = game(root);
  const installed = path.join(root, 'Safehouse Update Test'), binary = path.join(installed, 'SafehouseUpdateTest.exe');
  const uninstaller = () => fs.existsSync(installed) ? fs.readdirSync(installed).filter(name => /^Uninstall .+\.exe$/.test(name)).map(name => path.join(installed, name))[0] : undefined;
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1', SAFEHOUSE_INSTALL_TEST_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  let application, child, server, cache;
  const metadata = require('../package.json'), current = metadata.version;
  const previous = current.replace(/\d+$/, value => Number(value) - 1);
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const fixtureName = `safehouse-integration-test-${path.basename(root).toLowerCase()}`;
  const wrapper = `const { app, BrowserWindow, session, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const fixtureRoot = ${JSON.stringify(root)};
process.env.SAFEHOUSE_DATA_DIR = path.join(fixtureRoot, 'profile');
process.env.SAFEHOUSE_DISABLE_STEAMWORKS = '1';
process.env.SAFEHOUSE_INSTALL_TEST_ROOT = fixtureRoot;
process.env.SAFEHOUSE_INSTALL_TEST_FEED = fs.readFileSync(path.join(fixtureRoot, 'feed-url.txt'), 'utf8');
const moduleUpdates = require('./core/updates'); const Original = moduleUpdates.Updates;
moduleUpdates.Updates = class extends Original {
 constructor(options) { super(options); globalThis.fixtureUpdates = this;
  this.engine.setFeedURL({ provider: 'generic', url: process.env.SAFEHOUSE_INSTALL_TEST_FEED });
  this.engine.updateConfigPath = path.join(process.env.SAFEHOUSE_DATA_DIR, 'test-update.yml');
  this.engine.installDirectory = path.dirname(app.getPath('exe'));
  const install = this.engine.quitAndInstall.bind(this.engine); this.engine.quitAndInstall = () => install(true, true);
 }
};
require('./main.js');
app.once('before-quit', () => fs.writeFileSync(path.join(fixtureRoot, 'quit-requested'), '1'));
app.whenReady().then(() => {
 const timer = setInterval(async () => { const window = BrowserWindow.getAllWindows()[0];
  if (!window || !window.webContents.getURL().startsWith('file:') || window.webContents.isLoadingMainFrame()) return; clearInterval(timer);
  try {
   const { ConsoleLoginStore } = require('./core/console-login');
   const store = new ConsoleLoginStore({directory: app.getPath('userData'), safeStorage});
   if (app.getVersion() === '${previous}') {
    await store.save('https://fixture.invalid', {endpoint:'/api/auth/login',username:'fixture-user',password:'fixture-password'});
    const panel = session.fromPartition('persist:safehouse-center-console');
    await panel.cookies.set({url:'https://fixture.invalid',name:'update-fixture',value:'fixture-cookie',expirationDate:Date.now()/1000+86400,httpOnly:true,secure:true});
    await panel.cookies.flushStore();
    fs.writeFileSync(path.join(fixtureRoot,'baseline-ready'),'1'); return;
   }
   const remembered = await store.get('https://fixture.invalid');
   const cookie = await session.fromPartition('persist:safehouse-center-console').cookies.get({url:'https://fixture.invalid', name:'update-fixture'});
   const medium = require('node:child_process').execFileSync('whoami.exe',['/groups'],{encoding:'utf8',windowsHide:true}).includes('S-1-16-8192');
   fs.writeFileSync(path.join(process.env.SAFEHOUSE_INSTALL_TEST_ROOT, 'result.json'), JSON.stringify({version:app.getVersion(),exe:app.getPath('exe'),profile:app.getPath('userData'),session:app.getPath('sessionData'),mode:globalThis.fixtureUpdates.snapshot().mode,medium,cookie:cookie.some(value=>value.value==='fixture-cookie'),login:remembered?.username==='fixture-user' && remembered?.password==='fixture-password'}));
  } catch { fs.writeFileSync(path.join(process.env.SAFEHOUSE_INSTALL_TEST_ROOT,'result.json'),JSON.stringify({error:true})); }
  app.quit();
 }, 100);
});`;
  try {
    const { extractAll } = await import('@electron/asar');
    const staged = path.join(root, 'staged'); copyTree(source, staged);
    fs.renameSync(path.join(staged, 'Safehouse.exe'), path.join(staged, 'SafehouseUpdateTest.exe'));
    await run('icacls.exe', [path.join(staged, 'SafehouseUpdateTest.exe'), '/setintegritylevel', 'M'], env);
    const appDirectory = path.join(staged, 'resources/app'); extractAll(path.join(staged, 'resources/app.asar'), appDirectory);
    fs.rmSync(path.join(staged, 'resources/app.asar')); fs.rmSync(path.join(staged, 'resources/app.asar.unpacked'), { recursive: true, force: true });
    // Take the current production implementation; only bootstrap and version differ.
    for (const dir of ['core', 'renderer']) copyTree(path.join(__dirname, '..', dir), path.join(appDirectory, dir));
    for (const file of ['main.js', 'preload.js', 'console-preload.js']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(appDirectory, file));
    fs.writeFileSync(path.join(appDirectory, 'installer-fixture.cjs'), wrapper);
    const packageFile = path.join(appDirectory, 'package.json'), packaged = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    packaged.main = 'installer-fixture.cjs';
    for (const version of [previous, current]) {
      packaged.version = version; fs.writeFileSync(packageFile, JSON.stringify(packaged));
      const config = installerConfiguration({ output, version, test: true });
      // Integration fixtures avoid slow compression; release settings are unchanged.
      config.compression = 'store'; config.extraMetadata.main = 'installer-fixture.cjs'; config.extraMetadata.name = fixtureName;
      for (let attempt = 0; ; attempt++) {
        try { await build({ projectDir: path.join(__dirname, '..'), prepackaged: staged, targets: Platform.WINDOWS.createTarget('nsis'), publish: 'never', config }); break; }
        catch (error) { if (attempt || !/Can't open output file/.test(String(error))) throw error; await sleep(1500); }
      }
      await run('icacls.exe', [path.join(output, `Safehouse-Test-Setup-${version}.exe`), '/setintegritylevel', 'M'], env);
    }
    console.log('PASS isolated test installers built with separate application ID and executable');
    const next = path.join(output, `Safehouse-Test-Setup-${current}.exe`), nextSize = fs.statSync(next).size;
    const digest = crypto.createHash('sha512').update(fs.readFileSync(next)).digest('base64');
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/latest.yml')) { res.setHeader('Content-Type', 'text/yaml'); res.end(JSON.stringify({ version: current, files: [{ url: path.basename(next), sha512: digest, size: nextSize }], path: path.basename(next), sha512: digest })); }
      else if (req.url.startsWith('/Safehouse-Test-Setup-')) { res.writeHead(200, { 'Content-Length': nextSize }); fs.createReadStream(next).pipe(res); }
      else { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    env.SAFEHOUSE_INSTALL_TEST_FEED = `http://127.0.0.1:${server.address().port}/`;
    fs.writeFileSync(path.join(root, 'feed-url.txt'), env.SAFEHOUSE_INSTALL_TEST_FEED);
    cache = path.join(process.env.LOCALAPPDATA, `safehouse-installer-test-${path.basename(root)}`);
    fs.writeFileSync(path.join(profile, 'test-update.yml'), `provider: generic\nurl: ${env.SAFEHOUSE_INSTALL_TEST_FEED}\nupdaterCacheDirName: ${path.basename(cache)}\n`);
    fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'dark', language: 'zh-CN', autoTranslate: false }));
    const mod = path.join(addons, 'fixture-retained.vpk'); fs.writeFileSync(mod, vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Fixture retained" }', 'models/weapons/v_rifle_ak47.mdl': 'fixture' }));
    const modHash = hash(mod);
    await run(path.join(output, `Safehouse-Test-Setup-${previous}.exe`), ['/S', '/currentuser', `/D=${installed}`], env);
    assert.ok(fs.existsSync(binary)); assert.ok(uninstaller());
    console.log('PASS per-user silent installation creates application and uninstaller');
    // Attach only Chromium CDP. A Node inspector keeps Electron's shutdown
    // attached and is unsuitable for exercising quitAndInstall itself.
    child = spawn(binary, ['--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let output = ''; const timeout = setTimeout(() => reject(Error('Test CDP startup timed out: ' + output)), 30000);
      const receive = value => { output = (output + value).slice(-4000); const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output); if (match) { clearTimeout(timeout); resolve(match[1]); } };
      child.once('error', reject); child.stderr.on('data', receive); child.stdout.on('data', receive);
      child.once('exit', code => { clearTimeout(timeout); reject(Error(`Test app exited during CDP startup: ${code}`)); });
    });
    application = await chromium.connectOverCDP(endpoint);
    console.log('PASS installed application exposes Chromium CDP without a Node inspector');
    const context = application.contexts()[0], page = context.pages()[0] || await context.waitForEvent('page');
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    const before = await page.evaluate(() => window.safehouse.state()); assert.equal(before.data.version, previous); assert.equal(before.data.update.mode, 'installed');
    await page.evaluate(async () => { const result = await window.safehouse.favoriteAdd({ id: '77', title: 'Fixture retained favorite', tags: ['Weapons'] }); if (!result.ok) throw Error(result.error); });
    const readyDeadline = Date.now() + 15000;
    while (!fs.existsSync(path.join(root, 'baseline-ready')) && Date.now() < readyDeadline) await sleep(100);
    assert.ok(fs.existsSync(path.join(root, 'baseline-ready')));
    const saved = ['settings.json', 'favorites.json', 'console-logins.json'].map(name => [name, hash(path.join(profile, name))]);
    await page.locator('.nav[data-page="settings"]').click(); await page.locator('[data-action="update-check"]').click();
    await page.locator('#app-update-status[data-status="available"]').waitFor();
    await page.locator('[data-action="update-download"]').click(); await page.locator('#app-update-status[data-status="downloaded"]').waitFor({ timeout: 120000 });
    await page.locator('[data-action="update-install"]').click().catch(error => { if (!/closed/.test(error.message)) throw error; });
    const quitDeadline = Date.now() + 10000;
    while (!fs.existsSync(path.join(root, 'quit-requested')) && Date.now() < quitDeadline) await sleep(100);
    assert.ok(fs.existsSync(path.join(root, 'quit-requested')), 'updater requests application shutdown');
    // Disconnect the external debugger once the real updater requests quit.
    // A debugger can keep Chromium attached during shutdown and block NSIS.
    await application.close(); application = null;
    const resultFile = path.join(root, 'result.json'), deadline = Date.now() + 150000;
    while (!fs.existsSync(resultFile) && Date.now() < deadline) await sleep(500);
    assert.ok(fs.existsSync(resultFile), 'upgraded application must restart');
    const result = JSON.parse(fs.readFileSync(resultFile));
    assert.equal(result.version, current); assert.equal(result.exe, binary); assert.equal(result.profile, profile); assert.equal(result.session, profile); assert.equal(result.mode, 'installed');
    assert.equal(result.cookie, true); assert.equal(result.login, true); assert.equal(result.medium, true);
    for (const [name, digest] of saved) assert.equal(hash(path.join(profile, name)), digest, `${name} retained`);
    assert.equal(hash(mod), modHash);
    console.log('PASS real installed upgrade: client check, download, SHA-512 verification, installer, original directory and automatic restart');
    console.log('PASS settings, favorites, HttpOnly cookie, OS-encrypted remembered login and game VPK retained across upgrade');
    await sleep(2000);
    await run(uninstaller(), ['/S', '/currentuser'], env);
    const removedDeadline = Date.now() + 30000; while (fs.existsSync(binary) && Date.now() < removedDeadline) await sleep(300);
    assert.equal(fs.existsSync(binary), false);
    for (const [name, digest] of saved) assert.equal(hash(path.join(profile, name)), digest);
    assert.equal(hash(mod), modHash);
    console.log('PASS isolated uninstall removes application, retains user data and leaves game content unchanged');
  } finally {
    if (application) await application.close();
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; await sleep(500);
    }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (uninstaller()) await run(uninstaller(), ['/S', '/currentuser'], env).catch(() => {});
    if (cache && path.basename(cache).startsWith('safehouse-installer-test-installer-')) fs.rmSync(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    fs.rmSync(path.join(process.env.LOCALAPPDATA, fixtureName + '-updater'), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    if (path.dirname(root) === parent && path.basename(root).startsWith('installer-')) {
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
      catch { console.log('Test directory remains temporarily locked:', root); }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

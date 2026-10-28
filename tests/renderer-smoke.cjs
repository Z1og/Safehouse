const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { Library } = require('../core/library');
const { Downloads } = require('../core/downloads');
const { vpk, game } = require('./fixtures.cjs');

function browserExecutable() {
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of [process.env.SAFEHOUSE_BROWSER_BIN, ...candidates].filter(Boolean)) if (fs.existsSync(candidate)) return candidate;
  throw new Error('未找到 Chrome / Edge，请设置 SAFEHOUSE_BROWSER_BIN 并重跑 npm run smoke:renderer');
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-renderer-'));
  const { gameRoot, addons } = game(root), library = new Library({ gameRoot }), screenshots = path.join(root, 'screenshots'); fs.mkdirSync(screenshots);
  fs.writeFileSync(path.join(addons, 'one.vpk'), vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "测试地图甲" }', 'maps/shared.bsp': 'first' }));
  fs.writeFileSync(path.join(addons, 'two.vpk'), vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "测试地图乙" }', 'maps/shared.bsp': 'second' }));
  const data = { version: '0.1.0', language: 'zh-CN', steam: { available: true, running: false, account: { steamId: '76561190000000000', name: 'Fixture Steam Account', accountName: 'fixture', personaName: 'Fixture Steam Account' }, accounts: [] }, settings: { gameRoot, theme: 'light', autoTranslate: false, language: 'zh-CN' } };
  const docsDir = process.env.SAFEHOUSE_DOCS_SHOTS && path.resolve(process.env.SAFEHOUSE_DOCS_SHOTS);
  if (docsDir) {
    fs.mkdirSync(docsDir, { recursive: true });
    data.version = require('../package.json').version;
    data.gameRoot = 'D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2';
    data.settings.gameRoot = data.gameRoot;
    data.paths = [data.gameRoot + '\\left4dead2\\addons'];
  }
  let changed = () => {};
  const searchCalls = [];
  const downloads = new Downloads({ stateDir: path.join(root, 'state'), library, changed: () => changed() });
  const response = value => ({ ok: true, data: value });
  const bridge = {
    state: async () => response({ ...library.scan(), ...structuredClone(data), downloads: downloads.list(), discoveryWarnings: [] }),
    scan: async () => response({ ...library.scan(), ...structuredClone(data), downloads: downloads.list(), discoveryWarnings: [] }),
    enable: async (ids, enabled) => { const result = library.setEnabled(ids, enabled); changed(); return response(result); },
    chooseGame: async () => response({ ...library.scan(), ...structuredClone(data), downloads: downloads.list(), discoveryWarnings: [] }),
    chooseImports: async () => response(downloads.list()),
    import: async files => { downloads.enqueue(files); changed(); return response(downloads.list()); },
    uninstall: async () => response({ cancelled: true }),
    cancel: async id => response(downloads.cancel(id)), retry: async id => response(downloads.retry(id)), clearDownloads: async () => response(downloads.clear()),
    search: async (...args) => { searchCalls.push(args); return response({ items: [], page: args[1] || 1, hasMore: false }); }, details: async id => response({ id, title: 'Fixture Workshop Map', author: 'Fixture Creator', description: '', size: 0, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` }),
    translate: async text => response({ text: `翻译：${text}`, sourceLanguage: 'en', language: data.settings.language }),
    settings: async changes => { Object.assign(data.settings, changes); changed(); return response(data.settings); },
    open: async () => response(null), openSteam: async () => response(null), steamDownloads: async () => response(null), reveal: async () => response(null), launch: async () => response(null),
    window: async () => response(null), filePath: file => file.name,
  };
  const renderer = path.join(__dirname, '..', 'renderer');
  const server = http.createServer((request, res) => {
    if (request.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const file = request.url === '/' ? path.join(renderer, 'index.html') : path.resolve(renderer, `.${decodeURIComponent(request.url.split('?')[0])}`);
    if (!file.startsWith(renderer + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = path.extname(file) === '.html' ? 'text/html; charset=utf-8' : path.extname(file) === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" });
    fs.createReadStream(file).pipe(res);
  });
  let browser;
  try {
    server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'light' });
    // Ordinary renderer checks must not depend on Steam's decorative image CDN.
    if (!docsDir) await context.route('https://shared.fastly.steamstatic.com/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="180"><path fill="#738c7c" d="M0 0h960v180H0z"/></svg>' }));
    await context.exposeBinding('safehouseInvoke', async (_, method, args) => {
      if (!Object.hasOwn(bridge, method)) throw new Error('Unknown fixture method');
      try { return await bridge[method](...args); }
      catch (error) { return { ok: false, error: error.message }; }
    });
    await context.addInitScript(methods => {
      Object.defineProperty(window, 'safehouse', { configurable: false, value: {
        ...Object.fromEntries(methods.map(method => [method, (...args) => window.safehouseInvoke(method, args)])),
        filePath(file) { return file.name; },
        onChanged(listener) { window.addEventListener('safehouse:changed', listener); return () => window.removeEventListener('safehouse:changed', listener); },
      } });
    }, Object.keys(bridge));
    const page = await context.newPage(), errors = [];
    changed = () => { if (!page.isClosed()) page.evaluate(() => window.dispatchEvent(new Event('safehouse:changed'))).catch(() => {}); };
    page.on('pageerror', error => errors.push(error.message));
    const failed = []; page.on('console', message => { if (message.type() === 'error') failed.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    assert.equal(await page.locator('.content-card').count(), 2);
    console.log('PASS real Chrome renderer: initial local inventory and Miuix application layout');
    await page.screenshot({ path: path.join(screenshots, 'library.png'), fullPage: false });
    assert.equal(await page.locator('[data-page="conflicts"]').count(), 0);
    assert.equal(await page.locator('[data-action="login"]').count(), 0);
    await page.locator('[data-page="library"]').click(); await page.locator('[data-filter="disabled"]').click();
    assert.equal(await page.locator('.content-card').count(), 0);
    await page.locator('[data-filter="all"]').click(); await page.locator('[data-toggle]').first().click();
    await page.locator('[data-filter="disabled"]').click(); assert.equal(await page.locator('.content-card').count(), 1);
    await page.locator('[data-toggle]').click(); await page.getByText('没有找到匹配内容', { exact: true }).waitFor();
    console.log('PASS renderer: local enable state and removed conflict navigation');
    const mapFile = path.join(root, 'imported.vpk'); fs.writeFileSync(mapFile, vpk({ 'maps/imported.bsp': 'fixture' }));
    await page.evaluate(file => window.safehouse.import([file]), mapFile);
    await page.locator('[data-page="library"]').click(); await page.locator('[data-action="toggle-transfers"]').click(); await page.getByText('已完成', { exact: true }).waitFor({ timeout: 10000 });
    assert.ok(fs.existsSync(path.join(addons, 'imported.vpk')));
    console.log('PASS actual local package installation: VPK copied after validation');
    if (docsDir) {
      await page.locator('[data-action="clear-downloads"]').click();
      await page.locator('.transfer-panel').waitFor({ state: 'detached' });
      await page.locator('#toast.visible').waitFor({ state: 'hidden' });
      await page.locator('[data-page="library"]').click();
      await page.locator('[data-filter="all"]').click();
      await page.locator('.section-heading').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(docsDir, 'library-light.png') });
    }
    await page.locator('.nav[data-page="settings"]').click(); await page.locator('#theme-select').selectOption('dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    if (docsDir) {
      await page.locator('[data-page="library"]').click();
      await page.locator('.section-heading').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(docsDir, 'library-dark.png') });
    }
    console.log('PASS renderer: dark theme');
    await page.locator('[data-page="workshop"]').click();
    await page.locator('#workshop-category').selectOption('weapon');
    await page.waitForFunction(() => document.querySelector('#workshop-content .empty'));
    assert.equal(searchCalls.at(-1)[2], 'weapon');
    await page.screenshot({ path: path.join(screenshots, 'workshop.png'), fullPage: false });
    console.log('PASS renderer: public workshop browsing and category filter');
    await page.locator('.nav[data-page="settings"]').click();
    await page.getByRole('heading', { name: 'Steam 本地状态' }).waitFor();
    await page.locator('#main').getByText('Fixture Steam Account', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshots, 'settings.png'), fullPage: false });
    console.log('PASS renderer: local Steam account status without web login');
    assert.deepEqual(errors, []); assert.deepEqual(failed, []);
    console.log('PASS renderer: no JavaScript errors or failed local requests');
    if (process.env.SAFEHOUSE_SMOKE_SHOT) fs.copyFileSync(path.join(screenshots, 'library.png'), path.resolve(process.env.SAFEHOUSE_SMOKE_SHOT));
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

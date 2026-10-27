const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { game, vpk } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-panel-native-'));
  const { gameRoot, addons } = game(root), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const data = vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "客户端直连测试地图" }', 'maps/direct.bsp': 'fixture' });
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/file') || request.url.startsWith('/slow')) {
      response.writeHead(200, { 'Content-Length': data.length }); response.write(data.subarray(0, 4));
      if (request.url.startsWith('/file')) { const timer = setTimeout(() => response.end(data.subarray(4)), 700); response.on('close', () => clearTimeout(timer)); }
      return;
    }
    if (request.url === '/fixture-login' || request.url === '/fixture-logout') {
      response.setHeader('Set-Cookie', request.url === '/fixture-login' ? 'fixture-session=fixture-only; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600' : 'fixture-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); response.end('ok'); return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="zh-CN"><head><title>面板直连测试</title><style>body{margin:0;font:16px "Segoe UI",sans-serif;color:#182334;background:#f3f5f7}.layout{display:grid;grid-template-columns:220px 1fr;min-width:1000px;min-height:100vh}aside{background:white;padding:28px}main{padding:32px}article{background:white;padding:24px;border-radius:18px;max-width:680px}button{padding:12px 18px;border:0;border-radius:10px;margin:10px 10px 10px 0;background:#0876f9;color:white}</style></head><body><div class="layout"><aside><h2>生还者控制台</h2><p>地图管理</p><p>内容下载</p><p>服务器状态</p></aside><main><h1>地图管理</h1><article><h2>客户端直连测试地图</h2><p>通过与真实面板相同的下载助手协议传输 VPK。</p><button id="browserDirectDownload">原浏览器下载</button><button id="slow">慢速下载</button><p id="cloudDownloadMessage">需要下载助手</p><p id="result"></p></article><p id="remember-status">${request.headers.cookie?.includes('fixture-session=fixture-only') ? 'fixture 已登录' : 'fixture 未登录'}</p><button id="remember">记住测试会话</button><button id="forget">退出测试会话</button></main></div><script>
      function helper(action, detail={}) { return new Promise((resolve,reject)=>{ const requestId=crypto.randomUUID(); const timer=setTimeout(()=>reject(new Error('helper timeout')),5000); function receive(event){if(event.source===window && event.origin===location.origin && event.data?.source==='l4d2-download-helper' && event.data.requestId===requestId){clearTimeout(timer);window.removeEventListener('message',receive);event.data.ok?resolve(event.data):reject(new Error(event.data.error));}}window.addEventListener('message',receive);window.postMessage({source:'l4d2-control',requestId,action,...detail},location.origin);}); }
      async function download(slow){try{await helper('status');const result=await helper('download',{url:location.origin+(slow?'/slow':'/file')+'?signed=fixture-secret',name:slow?'cancel.vpk':'客户端地图.vpk',size:${data.length}});document.querySelector('#result').textContent=result.native?'已交给客户端下载':'未接管';}catch(error){document.querySelector('#result').textContent=error.message;}}
      document.querySelector('#browserDirectDownload').onclick=()=>download(false);document.querySelector('#slow').onclick=()=>download(true);
      document.querySelector('#remember').onclick=async()=>{await fetch('/fixture-login',{method:'POST'});localStorage.setItem('fixture-preference','maps');location.reload();};
      document.querySelector('#forget').onclick=async()=>{await fetch('/fixture-logout',{method:'POST'});location.reload();};
    </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: false, consoleUrl: url }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application, page, remote; const errors = [];
  async function launch() {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env, timeout: 30000 });
    page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor(); await page.locator('[data-page="console"]').click();
    await page.waitForFunction(() => document.querySelector('#console-status')?.dataset.status === 'ready');
    remote = application.context().pages().find(candidate => candidate !== page && candidate.url().startsWith(url)); assert.ok(remote);
    await remote.getByRole('heading', { name: '地图管理', exact: true }).waitFor();
  }
  async function native() { return application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0], view = win.contentView.children.find(child => child.webContents && child.webContents !== win.webContents); return { bounds: view.getBounds(), zoom: view.webContents.getZoomFactor(), partition: view.webContents.session.storagePath }; }); }
  try {
    await launch();
    assert.equal(await page.locator('#console-connect').isVisible(), false);
    assert.equal(await remote.locator('#browserDirectDownload').textContent(), '下载到客户端');
    assert.match(await remote.locator('#cloudDownloadMessage').textContent(), /已内置/);
    assert.deepEqual(await remote.evaluate(() => [typeof window.safehouse, typeof require, typeof process]), ['undefined', 'undefined', 'undefined']);
    const initial = await native(); assert.match(initial.partition, /Partitions/);
    const firstBounds = await page.locator('#console-viewport').boundingBox();
    assert.ok(Math.abs(firstBounds.width - initial.bounds.width) <= 1); assert.ok(firstBounds.height > 700);
    await page.locator('[data-action="console-wide"]').click();
    await page.waitForFunction(() => !document.querySelector('.sidebar').getBoundingClientRect().width);
    await page.waitForTimeout(150); const wide = await native(); assert.ok(wide.bounds.width > initial.bounds.width + 180);
    await page.locator('#console-zoom').selectOption('0.8'); await page.waitForTimeout(150); assert.equal((await native()).zoom, 0.8);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'))).consoleZoom, 0.8);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 700));
    await page.waitForTimeout(150); const small = await native();
    assert.ok(small.bounds.height > 480 && small.bounds.width > 900);
    assert.equal(await page.evaluate(() => document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth), true);
    console.log('PASS compact native panel bounds, minimum window, wide mode, manual zoom and persisted settings');

    await remote.locator('#browserDirectDownload').click(); await remote.getByText('已交给客户端下载', { exact: true }).waitFor();
    await page.getByRole('button', { name: '安装到模组管理', exact: true }).waitFor();
    const saved = path.join(profile, 'panel-downloads', '客户端地图.vpk'); assert.deepEqual(fs.readFileSync(saved), data);
    assert.ok(!fs.readFileSync(path.join(profile, 'downloads.json'), 'utf8').includes('fixture-secret'));
    await page.getByRole('button', { name: '安装到模组管理', exact: true }).click();
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await page.getByText('客户端直连测试地图', { exact: true }).first().waitFor(); assert.deepEqual(fs.readFileSync(path.join(addons, '客户端地图.vpk')), data);
    console.log('PASS real Electron download-helper handshake, actual HTTP streaming, native history and installation into temporary game');

    await page.locator('[data-page="console"]').click(); await remote.locator('#slow').click();
    await page.getByRole('button', { name: '取消', exact: true }).waitFor(); await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByText('已取消直连下载', { exact: true }).waitFor();
    assert.ok(!fs.existsSync(path.join(profile, 'panel-downloads', 'cancel.vpk')));
    assert.equal(fs.readdirSync(path.join(profile, 'panel-downloads')).some(name => name.endsWith('.part')), false);
    console.log('PASS native progress cancellation removes incomplete downloads');

    await remote.locator('#remember').click(); await remote.getByText('fixture 已登录', { exact: true }).waitFor();
    await application.close(); application = null; await launch();
    await remote.getByText('fixture 已登录', { exact: true }).waitFor();
    assert.equal(await remote.evaluate(() => localStorage.getItem('fixture-preference')), 'maps');
    assert.equal((await native()).zoom, 0.8);
    assert.ok(!fs.readFileSync(path.join(profile, 'settings.json'), 'utf8').includes('fixture-session'));
    console.log('PASS process restart retains panel HttpOnly login cookie and site preferences in stable per-user partition');
    await remote.locator('#forget').click(); await remote.getByText('fixture 未登录', { exact: true }).waitFor();
    await application.close(); application = null; await launch();
    await remote.getByText('fixture 未登录', { exact: true }).waitFor(); assert.deepEqual(errors, []);
    console.log('PASS explicit panel logout remains effective after another process restart');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 940));
    await page.locator('[data-action="console-wide"]').click(); await page.waitForTimeout(200);
    const output = path.join(__dirname, '../output/playwright'); fs.mkdirSync(output, { recursive: true });
    const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(output, 'console-adapted-native.png'), Buffer.from(png, 'base64'));
  } finally {
    if (application) await application.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

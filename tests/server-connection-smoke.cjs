const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { game } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-connect-')), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const { gameRoot } = game(root);
  function fixture(name, endpoint) {
    return http.createServer((request, response) => {
      if (request.url === '/offline') { request.socket.destroy(); return; }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>${name}</title></head><body><h1>${name}</h1>${request.url === '/login' ? '<p>请登录</p>' : request.url === '/mirror' ? `<span data-game-address>${endpoint}</span>` : `<textarea id="serverConnectCommand">connect ${endpoint}</textarea><button id="change" onclick="document.querySelector('textarea').value='connect changed.example:27199'">更改地址</button><button id="invalid" onclick="document.querySelector('textarea').value='connect game.example:27015;quit'">无效地址</button>`}</body></html>`);
    });
  }
  const a = fixture('面板 A', '192.0.2.17:27025'), b = fixture('面板 B', '[2001:db8::18]:28016');
  await Promise.all([a, b].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  const urlA = `http://127.0.0.1:${a.address().port}/`, urlB = `http://127.0.0.1:${b.address().port}/`;
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: false, consoleUrl: urlA }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application, savedClipboard;
  try {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env, timeout: 30000 });
    const page = await application.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    savedClipboard = await application.evaluate(({ clipboard }) => clipboard.readText());
    const command = page.locator('#server-connection-command'), copy = page.getByRole('button', { name: '复制服务器连接命令', exact: true });
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor(); assert.ok(await copy.isDisabled());
    await page.locator('[data-page="console"]').click();
    await page.waitForFunction(() => document.querySelector('#server-connection-command')?.textContent === 'connect 192.0.2.17:27025');
    await copy.click(); assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), 'connect 192.0.2.17:27025');
    let remote = application.context().pages().find(candidate => candidate.url().startsWith(urlA)); assert.ok(remote);
    await remote.locator('#change').click(); await page.waitForFunction(() => document.querySelector('#server-connection-command').textContent === 'connect changed.example:27199');
    await command.click(); assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), 'connect changed.example:27199');
    await page.locator('[data-page="library"]').click(); assert.equal(await command.textContent(), 'connect changed.example:27199');
    assert.ok(await command.isVisible());
    console.log('PASS sidebar card copies the actual game port; DOM property updates and cross-page visibility stay current');

    await page.locator('[data-page="console"]').click(); await page.locator('[data-action="console-address"]').click();
    async function connect(url) { await page.locator('#console-url').fill(url); await page.locator('#console-connect').getByRole('button').click(); }
    await connect(urlB);
    await page.waitForFunction(() => document.querySelector('#server-connection-command').textContent === 'connect [2001:db8::18]:28016');
    await copy.click(); assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), 'connect [2001:db8::18]:28016');
    remote = application.context().pages().find(candidate => candidate.url().startsWith(urlB)); assert.ok(remote);
    await remote.locator('#invalid').click(); await page.waitForFunction(() => document.querySelector('#server-connection-command').disabled);
    assert.equal(await command.textContent(), '暂未获取服务器地址');
    console.log('PASS switching panel origins uses the new server endpoint, supports IPv6 and rejects injected game commands');

    await connect(urlB + 'mirror'); await page.waitForFunction(() => document.querySelector('#server-connection-command').textContent === 'connect [2001:db8::18]:28016');
    await connect(urlB + 'login'); await page.waitForFunction(() => document.querySelector('#console-status').dataset.status === 'ready' && document.querySelector('#server-connection-command').disabled);
    assert.equal(await command.textContent(), '暂未获取服务器地址');
    await connect(urlA); await page.waitForFunction(() => !document.querySelector('#server-connection-command').disabled);
    await connect(urlA + 'offline'); await page.waitForFunction(() => document.querySelector('#console-status').dataset.status === 'error');
    assert.ok(await copy.isDisabled()); assert.equal(await command.textContent(), '暂未获取服务器地址');
    assert.deepEqual(errors, []);
    console.log('PASS address mirrors, login pages and offline panels clear stale commands instead of guessing from the panel URL');
    await connect(urlA); await page.waitForFunction(() => !document.querySelector('#server-connection-command').disabled);
    fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true }); await page.screenshot({ path: path.join(__dirname, '../output/playwright/server-connection-card.png') });
  } finally {
    if (application) { if (savedClipboard !== undefined) await application.evaluate(({ clipboard }, text) => clipboard.writeText(text), savedClipboard).catch(() => {}); await application.close(); }
    for (const server of [a, b]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { runtime } = require('../scripts/runtime.cjs');
const { game } = require('./fixtures.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-login-smoke-')), profile = path.join(root, 'profile');
  fs.mkdirSync(profile); const { gameRoot } = game(root);
  let expectedPassword = 'fixture-only-password', logins = 0;
  const sessions = new Map();
  const loginHtml = `<!doctype html><meta charset="utf-8"><title>Panel fixture</title><h1>面板登录</h1>
    <section><form id="authorizedForm"><label>管理账号<input id="adminUsername" required></label><label>管理密码<input id="adminPassword" type="password" autocomplete="current-password" required></label><button type="submit">授权登录</button></form></section>
    <section><form id="ordinaryForm"><label>资料链接<input id="profileLink" required></label><label>面板密码<input id="ordinaryPassword" type="password" autocomplete="current-password" required></label><button type="submit">普通登录</button></form></section><p id="loginMessage"></p>
    <script>for(const [id,endpoint,field,account,password] of [['authorizedForm','login','username','adminUsername','adminPassword'],['ordinaryForm','guest','profile','profileLink','ordinaryPassword']])document.getElementById(id).onsubmit=async event=>{event.preventDefault();const response=await fetch('/api/auth/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({[field]:document.getElementById(account).value,password:document.getElementById(password).value})});if(response.ok)location.replace('/');else document.querySelector('#loginMessage').textContent='登录失败';};</script>`;
  function createPanel() {
    return http.createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const id = /(?:^|;\s*)l4d2-session=([^;]+)/.exec(req.headers.cookie || '')?.[1], session = sessions.get(id);
      const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      if (req.url === '/api/auth/session') { json({ authenticated: Boolean(session), role: session?.role || null }); return; }
      if (req.method === 'POST' && ['/api/auth/login', '/api/auth/guest'].includes(req.url)) {
        logins++; const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        if (body.password !== expectedPassword || !(body.username === 'fixture-admin' || body.profile === 'fixture-profile')) { res.statusCode = 401; json({ error: 'denied' }); return; }
        const next = randomBytes(32).toString('hex'); sessions.set(next, { role: req.url.endsWith('/guest') ? 'guest' : 'admin' });
        res.setHeader('Set-Cookie', `l4d2-session=${next}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`); json({ authenticated: true }); return;
      }
      if (req.url === '/api/auth/logout') { sessions.delete(id); res.setHeader('Set-Cookie', 'l4d2-session=signed-out; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400'); json({ ok: true }); return; }
      if (req.url === '/login') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(loginHtml); return; }
      if (req.url === '/') {
        if (!session) { res.writeHead(302, { Location: '/login' }); res.end(); return; }
        res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end('<meta charset="utf-8"><h1>Fixture panel</h1><button id="logout">退出登录</button><script>document.querySelector("#logout").onclick=async()=>{await fetch("/api/auth/logout",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});location.replace("/login");};</script>'); return;
      }
      res.writeHead(404); res.end();
    });
  }
  const server = createPanel(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: false, consoleUrl: url }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application, page, remote; const errors = [];
  const vault = () => path.join(profile, 'console-logins.json');
  const entries = () => fs.existsSync(vault()) ? Object.keys(JSON.parse(fs.readFileSync(vault(), 'utf8')).entries).length : 0;
  async function launch(binary) {
    application = await electron.launch({ executablePath: binary || runtime(), args: binary || process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env, timeout: 30000 });
    page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor(); await page.locator('[data-page="console"]').click();
    await page.waitForFunction(() => document.querySelector('#console-status')?.dataset.status === 'ready');
    remote = application.context().pages().find(candidate => candidate !== page && candidate.url().startsWith(url)); assert.ok(remote);
  }
  async function close() { await application.close(); application = null; }
  async function signedIn() { await remote.getByRole('heading', { name: 'Fixture panel', exact: true }).waitFor(); }
  async function signIn(remember, guest = false, legacy = false) {
    await remote.getByRole('heading', { name: '面板登录', exact: true }).waitFor();
    const form = remote.locator(guest ? '#ordinaryForm' : '#authorizedForm');
    await form.locator(guest ? '#profileLink' : '#adminUsername').fill(guest ? 'fixture-profile' : 'fixture-admin');
    await form.locator(guest ? '#ordinaryPassword' : '#adminPassword').fill(expectedPassword);
    if (!legacy) { const checkbox = form.getByRole('checkbox'); await checkbox.waitFor(); if (remember) await checkbox.check(); }
    await form.getByRole('button', { name: guest ? '普通登录' : '授权登录', exact: true }).click(); await signedIn();
  }
  try {
    await launch(process.env.SAFEHOUSE_UPGRADE_FROM_BIN); await signIn(false, false, Boolean(process.env.SAFEHOUSE_UPGRADE_FROM_BIN)); await close();
    const count = logins; await launch(); await signedIn(); assert.equal(logins, count); assert.equal(entries(), 0);
    const paths = await application.evaluate(({ app, BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(child => child.webContents);
      return { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), partition: view.webContents.session.storagePath };
    });
    assert.equal(paths.userData, profile); assert.equal(paths.sessionData, profile); assert.ok(paths.partition.startsWith(profile + path.sep));
    console.log('PASS upgrade preserves an existing HttpOnly cookie without saving passwords; permanent userData and sessionData are aligned');

    await remote.locator('#logout').click(); await signIn(true);
    await page.waitForFunction(() => !document.querySelector('#console-forget-login').disabled); assert.equal(entries(), 1);
    const raw = fs.readFileSync(vault(), 'utf8'); for (const value of ['fixture-admin', expectedPassword, new URL(url).origin]) assert.ok(!raw.includes(value));
    await close(); const rememberedCount = logins; await launch(process.env.SAFEHOUSE_RELOCATED_BIN); await signedIn(); assert.equal(logins, rememberedCount);
    console.log('PASS explicit remember encrypts account and password with real OS safeStorage; a new process keeps both cookie and encrypted login');

    await close(); sessions.clear(); await launch(process.env.SAFEHOUSE_RELOCATED_BIN); await signedIn(); assert.equal(logins, rememberedCount + 1);
    console.log('PASS server memory-session loss or expired cookie transparently reauthenticates using the opted-in login');

    const other = createPanel(); await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    try {
      const otherUrl = `http://127.0.0.1:${other.address().port}/`, before = logins;
      await page.evaluate(async value => { const result = await window.safehouse.consoleConnect(value); if (!result.ok) throw new Error(result.error); }, otherUrl);
      await page.waitForTimeout(400);
      const otherPage = application.context().pages().find(candidate => candidate !== page && candidate.url().startsWith(otherUrl)); assert.ok(otherPage);
      // Cookies are host scoped, while saved credentials are isolated by full origin.
      await otherPage.goto(otherUrl + 'login'); await otherPage.getByRole('heading', { name: '面板登录', exact: true }).waitFor();
      await otherPage.locator('#authorizedForm input[type=checkbox]').waitFor(); assert.equal(await otherPage.locator('#authorizedForm input[type=checkbox]').isChecked(), false); assert.equal(logins, before);
      await page.evaluate(async value => { const result = await window.safehouse.consoleConnect(value); if (!result.ok) throw new Error(result.error); }, url);
      await page.waitForTimeout(400); remote = application.context().pages().find(candidate => candidate !== page && candidate.url().startsWith(url)); await signedIn();
    } finally { other.closeAllConnections(); await new Promise(resolve => other.close(resolve)); }
    console.log('PASS another panel origin never receives remembered credentials');

    await remote.locator('#logout').click(); await remote.getByRole('heading', { name: '面板登录', exact: true }).waitFor(); assert.equal(entries(), 0);
    const signedOutCount = logins; await close(); await launch(); await remote.getByRole('heading', { name: '面板登录', exact: true }).waitFor();
    assert.equal(logins, signedOutCount); assert.equal(entries(), 0);
    console.log('PASS explicit panel logout deletes remembered credentials and remains signed out across process restart');

    await signIn(true, true); assert.equal(entries(), 1);
    await page.locator('#console-forget-login').click(); assert.equal(entries(), 0); await signedIn();
    await close(); sessions.clear(); await launch(); await remote.getByRole('heading', { name: '面板登录', exact: true }).waitFor();
    assert.equal(entries(), 0); console.log('PASS guest login can be remembered; toolbar forget removes only saved credentials and disables future automatic login');

    await signIn(true); await close(); sessions.clear(); expectedPassword = 'fixture-only-changed'; const attempts = logins;
    await launch(); await remote.getByText('登录已失效，请使用当前账号密码重新登录', { exact: true }).waitFor();
    assert.equal(logins, attempts + 1); assert.equal(entries(), 0); await remote.reload(); await page.waitForTimeout(300); assert.equal(logins, attempts + 1);
    assert.deepEqual(errors, []); console.log('PASS changed server password invalidates the saved account without retries or bypassing server authorization');
  } finally {
    if (application) await application.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

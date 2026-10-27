const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { game, vpk } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-console-search-'));
  const { gameRoot, addons } = game(root), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  fs.writeFileSync(path.join(addons, 'miku.vpk'), vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Hatsune Miku Maid for Nick" }', 'models/survivors/survivor_gambler.mdl': 'fixture' }));
  fs.writeFileSync(path.join(addons, 'other.vpk'), vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Silver Armor for Coach" }', 'models/survivors/survivor_coach.mdl': 'fixture' }));
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push([request.method, request.url]);
    if (request.url === '/unavailable') { response.writeHead(503); response.end('Panel unavailable'); return; }
    if (request.url === '/offline') { request.socket.destroy(); return; }
    if (request.url.startsWith('/auth') && request.headers.authorization !== 'Basic ' + Buffer.from('fixture:fixture-pass').toString('base64')) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Safehouse test panel"' }); response.end('Authentication required'); return;
    }
    if (request.url === '/api/status') { response.setHeader('Content-Type', 'application/json'); response.end('{"status":"fixture ready"}'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="zh-CN"><head><title>生还者控制台 · 测试面板</title></head><body><h1>服务器面板已接入</h1><p id="status"></p><a href="/maps">地图管理</a><a href="https://example.invalid/">外部站点</a><script>fetch("/api/status").then(r=>r.json()).then(v=>document.querySelector("#status").textContent=v.status)</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: false }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await electron.launch({ args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], executablePath: runtime(), env, timeout: 30000 });
    const page = await application.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await application.evaluate(({ session }) => {
      session.defaultSession.protocol.handle('https', request => {
        const url = new URL(request.url);
        if (url.hostname === 'translate.googleapis.com') return new Response(JSON.stringify([[['silver armor']], null, 'zh-CN']), { headers: { 'Content-Type': 'application/json' } });
        if (url.hostname === 'api.steampowered.com') return new Response(JSON.stringify({ response: { publishedfiledetails: [{ result: 1, publishedfileid: '1', consumer_app_id: 550, title: 'Hatsune Miku for Nick', description: 'Replaces Nick.', creator: 'fixture', tags: [{ tag: 'Survivors' }, { tag: 'Nick' }] }] } }), { headers: { 'Content-Type': 'application/json' } });
        if (url.hostname === 'steamcommunity.com' && url.pathname.includes('/workshop/browse')) {
          const query = url.searchParams.get('searchtext'), page = Number(url.searchParams.get('p')) || 1;
          const start = query === '初音' ? 1 : 16;
          const results = query ? Array.from({ length: 30 }, (_, index) => ({ consumer_appid: 550, publishedfileid: String(start + (page - 1) * 30 + index), title: `Hatsune Miku ${start + index}`, tags: [{ tag: 'Survivors' }, { tag: 'Nick' }] })) : [];
          const data = { renderContext: { queryData: { queries: [{ queryKey: ['workshop_browse', { appid: 550 }], state: { data: { results, current_page: page, total_pages: query ? 2 : 1 } } }] } } };
          return new Response(`<script id="valve-ssr-data" type="application/json">${JSON.stringify(data)}</script>`, { headers: { 'Content-Type': 'text/html' } });
        }
        return new Response('', { status: 404 });
      });
    });
    await page.locator('#library-search').fill('初音 尼克');
    await page.waitForFunction(() => document.querySelectorAll('.content-card').length === 1 && document.querySelector('.card-title').textContent.includes('Hatsune'));
    await page.locator('#library-search').fill('银色盔甲');
    await page.waitForFunction(() => document.querySelectorAll('.content-card').length === 1 && document.querySelector('#library-search-note').textContent.includes('silver armor'));
    await page.locator('#library-search').fill('银色盔甲'); await page.locator('#library-search').fill('初音');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.content-card').count(), 1); assert.match(await page.locator('.card-title').textContent(), /Hatsune/);
    console.log('PASS bilingual local search: Chinese aliases, translated arbitrary phrases, and stale-query protection');
    await page.locator('[data-page="workshop"]').click();
    await page.locator('#workshop-category').selectOption('survivor'); await page.locator('#workshop-subcategory').selectOption('nick');
    await page.locator('#workshop-search').fill('初音'); await page.locator('#workshop-form').getByRole('button').click();
    await page.waitForFunction(() => document.querySelectorAll('.content-card').length === 30 && document.querySelector('#workshop-search-note').textContent.includes('hatsune miku'));
    const firstIds = await page.locator('.content-card .cover').evaluateAll(elements => elements.map(element => element.dataset.detail));
    const firstCard = page.locator('.content-card').first();
    assert.match(await firstCard.locator('[data-classification="survivor:nick"]').textContent(), /尼克/);
    assert.equal(await firstCard.locator('[data-classification="survivor:nick"]').getAttribute('data-source'), 'steam');
    assert.match(await firstCard.locator('.workshop-tags').textContent(), /幸存者/);
    await firstCard.getByRole('button', { name: '详情', exact: true }).click();
    await page.locator('#details-dialog [data-classification="survivor:nick"]').waitFor();
    assert.match(await page.locator('#details-dialog').textContent(), /分类参考作者标签/);
    await page.locator('#details-dialog .dialog-close').click();
    fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../output/playwright/workshop-labels.png') });
    console.log('PASS workshop cards and details: specific Chinese survivor badges with visible classification sources');
    await page.locator('[data-action="next-page"]').click();
    await page.waitForFunction(() => document.querySelector('.pager')?.textContent.includes('第 2 页'));
    const secondIds = await page.locator('.content-card .cover').evaluateAll(elements => elements.map(element => element.dataset.detail));
    assert.equal(new Set([...firstIds, ...secondIds]).size, 60);
    await page.locator('[data-action="previous-page"]').click();
    await page.waitForFunction(() => document.querySelector('.pager')?.textContent.includes('第 1 页'));
    assert.deepEqual(await page.locator('.content-card .cover').evaluateAll(elements => elements.map(element => element.dataset.detail)), firstIds);
    console.log('PASS bilingual workshop search: translated query, preserved subtype, deduplicated pagination, and stable back navigation');

    await page.locator('[data-page="console"]').click();
    await page.getByRole('heading', { name: '连接你的服务器面板', exact: true }).waitFor();
    assert.equal(await page.locator('#console-url').inputValue(), '');
    assert.equal(hits.length, 0);
    await page.locator('#console-url').fill(url); await page.locator('#console-connect').getByRole('button').click();
    // Collapse again so the existing address-toggle flow below still starts closed.
    await page.locator('[data-action="console-address"]').click();
    await page.waitForFunction(() => document.querySelector('#console-status').dataset.status === 'ready');
    const remote = application.context().pages().find(candidate => candidate !== page && candidate.url().startsWith(url));
    assert.ok(remote, 'native embedded panel exists');
    await remote.getByRole('heading', { name: '服务器面板已接入' }).waitFor(); await remote.getByText('fixture ready').waitFor();
    assert.deepEqual(await remote.evaluate(() => [typeof window.safehouse, typeof require, typeof process]), ['undefined', 'undefined', 'undefined']);
    const native = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0], view = window.contentView.children.find(child => child.webContents && child.webContents !== window.webContents);
      const preferences = view.webContents.getLastWebPreferences();
      return { bounds: view.getBounds(), sandbox: preferences.sandbox, node: preferences.nodeIntegration, preload: preferences.preload || '', isolated: preferences.contextIsolation };
    });
    assert.equal(native.sandbox, true); assert.equal(native.node, false); assert.equal(native.isolated, true);
    const helper = await remote.evaluate(() => new Promise(resolve => {
      const requestId = 'smoke-status';
      window.addEventListener('message', function reply(event) { if (event.data?.source === 'l4d2-download-helper' && event.data.requestId === requestId) { window.removeEventListener('message', reply); resolve(event.data); } });
      window.postMessage({ source: 'l4d2-control', requestId, action: 'status' }, location.origin);
      setTimeout(() => resolve({ ok: false, error: 'helper timeout' }), 3000);
    }));
    assert.equal(helper.ok, true, helper.error); assert.equal(helper.native, true);
    const bounds = await page.locator('#console-viewport').boundingBox(); assert.ok(Math.abs(native.bounds.x - bounds.x) <= 1 && Math.abs(native.bounds.height - bounds.height) <= 1);
    await remote.evaluate(() => { location.hash = 'workshop'; const frame = document.createElement('iframe'); frame.id = 'fixture-subframe'; frame.srcdoc = '<p>Subframe ready</p>'; document.body.append(frame); });
    await remote.frameLocator('#fixture-subframe').getByText('Subframe ready').waitFor();
    assert.equal(await page.locator('#console-status').getAttribute('data-status'), 'ready', 'hash and subframe loads must not leave a loaded panel stuck on connecting');
    await remote.getByRole('link', { name: '地图管理' }).click(); await remote.waitForURL(`${url}maps`);
    await remote.getByRole('link', { name: '外部站点' }).click({ noWaitAfter: true });
    await page.locator('#toast').filter({ hasText: '已阻止跳转' }).waitFor(); assert.equal(remote.url(), `${url}maps`);
    await page.locator('[data-page="library"]').click();
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(child => child.webContents && child.webContents !== BrowserWindow.getAllWindows()[0].webContents).length), 0);
    await page.locator('[data-page="console"]').click(); assert.equal(remote.url(), `${url}maps`);
    console.log('PASS center console: native embed, isolated sandbox, same-origin navigation, external navigation block, and tab lifecycle');
    await page.locator('[data-action="console-address"]').click();
    await page.locator('#console-url').fill(`${url}auth`); await page.locator('#console-connect').getByRole('button').click();
    await page.locator('#console-auth').waitFor();
    await page.locator('[aria-label="面板账号"]').fill('fixture'); await page.locator('[aria-label="面板密码"]').fill('fixture-pass');
    await page.locator('#console-auth').getByRole('button').click();
    await page.waitForFunction(() => document.querySelector('#console-status').dataset.status === 'ready');
    const saved = fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'); assert.match(saved, /auth/); assert.ok(!saved.includes('fixture-pass'));
    await page.locator('#console-url').fill(`${url}unavailable`); await page.locator('#console-connect').getByRole('button').click();
    await page.waitForFunction(() => document.querySelector('#console-status').dataset.status === 'error' && document.querySelector('#console-status').textContent.includes('503'));
    await page.locator('#console-url').fill(`${url}offline`); await page.locator('#console-connect').getByRole('button').click();
    await page.getByRole('heading', { name: '暂时无法连接面板' }).waitFor();
    await page.locator('#console-url').fill(url); await page.locator('#console-connect').getByRole('button').click();
    await page.waitForFunction(() => document.querySelector('#console-status').dataset.status === 'ready');
    assert.ok(hits.every(([method]) => method === 'GET')); assert.deepEqual(errors, []);
    console.log('PASS panel login, address persistence without credentials, connection failure/retry, and read-only fixture requests');
    if (process.env.SAFEHOUSE_CONSOLE_SHOT) {
      const encoded = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
      fs.writeFileSync(process.env.SAFEHOUSE_CONSOLE_SHOT, Buffer.from(encoded, 'base64'));
    }
  } finally {
    if (application) await application.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { game } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-translation-ui-'));
  const { gameRoot } = game(root), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: true }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application, page;
  const errors = [];
  try {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env, timeout: 30000 });
    page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await application.evaluate(({ session }) => {
      globalThis.translationFixture = { mode: 'success', waiting: [], calls: [], gated: 0 };
      const titles = ['Hiding Gnome [Vscript]', 'Slow background title', 'Partial title', 'Stale title'];
      const descriptions = ['For single player and local co-op.', 'Failed description', 'Partial description', 'Stale description'];
      session.defaultSession.protocol.handle('https', async request => {
        const url = new URL(request.url), state = globalThis.translationFixture;
        if (url.hostname === 'cn.bing.com' && url.pathname === '/translator') return new Response('<div data-iid="translator.fixture"></div><script>var _G={IG:"fixture-ig"};var params_AbusePreventionHelper=[12345,"fixture-token",3600000];</script>');
        if (url.hostname === 'cn.bing.com' || url.hostname === 'translate.googleapis.com') {
          const text = url.hostname === 'cn.bing.com' ? new URLSearchParams(await request.text()).get('text') : url.searchParams.get('q');
          state.calls.push(text);
          if (text === 'Slow background title' || state.mode === 'stale' && text === 'Stale description') {
            state.gated++; await new Promise(resolve => state.waiting.push(resolve));
          }
          if (state.mode === 'failure' || state.mode === 'partial' && text === 'Partial description') return new Response('', { status: 503 });
          const translation = { 'Hiding Gnome [Vscript]': '隐藏侏儒 [Vscript]', 'For single player and local co-op.': '适用于单人游戏和本地合作。' }[text] || '中文：' + text;
          return new Response(JSON.stringify(url.hostname === 'cn.bing.com' ? [{ detectedLanguage: { language: 'en' }, translations: [{ text: translation, to: 'zh-Hans' }] }] : [[[translation]], null, 'en']));
        }
        if (url.hostname === 'steamcommunity.com' && url.pathname.includes('/workshop/browse')) {
          const results = titles.map((title, index) => ({ consumer_appid: 550, publishedfileid: String(index + 1), title, tags: [{ tag: 'Scripts' }] }));
          return new Response(`<script id="valve-ssr-data" type="application/json">${JSON.stringify({ renderContext: { queryData: { queries: [{ queryKey: ['workshop_browse', { appid: 550 }], state: { data: { results, current_page: 1, total_pages: 1 } } }] } } })}</script>`, { headers: { 'Content-Type': 'text/html' } });
        }
        if (url.hostname === 'api.steampowered.com') {
          const form = new URLSearchParams(await request.text()), id = form.get('publishedfileids[0]'), index = Number(id) - 1;
          return new Response(JSON.stringify({ response: { publishedfiledetails: [{ result: 1, publishedfileid: id, consumer_app_id: 550, title: index === 1 ? 'Failed title' : titles[index], description: descriptions[index], creator: 'fixture', tags: [{ tag: 'Scripts' }] }] } }));
        }
        return new Response('', { status: 404 });
      });
    });
    const mode = value => application.evaluate((_, value) => { globalThis.translationFixture.mode = value; }, value);
    const release = () => application.evaluate(() => { globalThis.translationFixture.waiting.splice(0).forEach(resolve => resolve()); });
    const card = id => page.locator('.content-card').filter({ has: page.locator(`.card-title[data-detail="${id}"]`) });
    const open = id => card(id).getByRole('button', { name: '详情', exact: true }).click();
    const close = () => page.locator('#details-dialog .dialog-close').click();
    await page.locator('[data-page="workshop"]').click();
    await card('1').getByRole('button', { name: '隐藏侏儒 [Vscript]', exact: true }).waitFor();
    assert.equal(await card('2').locator('.card-title').textContent(), 'Slow background title');
    assert.ok(await application.evaluate(() => globalThis.translationFixture.gated > 0));
    console.log('PASS native translation: completed card titles appear while another translation is still pending');
    await release(); await open('1');
    await page.locator('#details-dialog h2').filter({ hasText: '隐藏侏儒' }).waitFor();
    await page.getByText('适用于单人游戏和本地合作。', { exact: true }).waitFor();
    await page.locator('.detail-translation').getByText('已翻译为 zh-CN · 必应', { exact: true }).waitFor();
    await page.getByRole('button', { name: '查看原文', exact: true }).click();
    assert.equal(await page.locator('#details-dialog h2').textContent(), 'Hiding Gnome [Vscript]');
    await page.getByRole('button', { name: '查看翻译', exact: true }).click();
    assert.equal(await page.locator('#details-dialog h2').textContent(), '隐藏侏儒 [Vscript]');
    console.log('PASS native translation: Bing title and description display, service label and original-text toggle');

    await close(); await mode('failure'); await open('2');
    await page.getByRole('button', { name: '重试翻译', exact: true }).waitFor();
    assert.equal(await page.locator('.detail-translation .spinner').count(), 0);
    assert.equal(await page.locator('#details-dialog h2').textContent(), 'Failed title');
    assert.match(await page.locator('.detail-translation').textContent(), /保留原文.*暂不可用/);
    await mode('success'); await page.getByRole('button', { name: '重试翻译', exact: true }).click();
    await page.locator('#details-dialog h2').filter({ hasText: '中文：Failed title' }).waitFor();
    await page.getByText('中文：Failed description', { exact: true }).waitFor();
    console.log('PASS native translation: both services fail visibly, spinner stops, explicit retry recovers');

    await close(); await mode('partial'); await open('3');
    await page.getByRole('button', { name: '重试翻译', exact: true }).waitFor();
    assert.equal(await page.locator('#details-dialog h2').textContent(), '中文：Partial title');
    assert.equal(await page.locator('.detail-description').textContent(), 'Partial description');
    assert.match(await page.locator('.detail-translation').textContent(), /部分内容保留原文/);
    await mode('success'); await page.getByRole('button', { name: '重试翻译', exact: true }).click();
    await page.getByText('中文：Partial description', { exact: true }).waitFor();
    console.log('PASS native translation: successful title remains visible when description fails; retry completes missing text');

    await close(); await mode('stale'); await open('4');
    await page.waitForFunction(() => document.querySelector('.detail-translation')?.textContent.includes('正在继续'));
    await close(); await open('1'); await release();
    await page.getByText('适用于单人游戏和本地合作。', { exact: true }).waitFor();
    assert.equal(await page.locator('#details-dialog h2').textContent(), '隐藏侏儒 [Vscript]');
    assert.deepEqual(errors, []);
    const output = path.join(__dirname, '../output/playwright'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'translation-fixed.png') });
    console.log('PASS native translation: late results cannot overwrite a newly opened detail; no renderer errors');
  } finally {
    if (application) {
      await application.evaluate(() => globalThis.translationFixture?.waiting.splice(0).forEach(resolve => resolve())).catch(() => {});
      await application.close();
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

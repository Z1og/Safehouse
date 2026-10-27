// Read-only live verification: no subscriptions, server actions, or game file writes.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { runtime } = require('../scripts/runtime.cjs');
(async () => {
  if (!process.env.SAFEHOUSE_PANEL_URL) throw new Error('请设置 SAFEHOUSE_PANEL_URL 为你自己的面板地址');
  const panelUrl = new URL(process.env.SAFEHOUSE_PANEL_URL);
  if (!['http:', 'https:'].includes(panelUrl.protocol) || panelUrl.username || panelUrl.password) throw new Error('面板地址只支持不带凭据的 HTTP / HTTPS');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-live-search-'));
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ theme: 'light', autoTranslate: false, language: 'zh-CN', consoleUrl: panelUrl.href }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: root }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env, timeout: 30000 });
    const page = await application.firstWindow(); await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    const search = await page.evaluate(() => window.safehouse.search('初音', 1, 'survivor', 'nick'));
    assert.ok(search.ok, search.error); assert.ok(search.data.items.some(item => /miku/i.test(item.title)), 'Chinese query must return English Miku titles');
    console.log(JSON.stringify({ liveChineseSearch: { count: search.data.items.length, queries: search.data.search.queries, titles: search.data.items.slice(0, 5).map(item => item.title) } }, null, 2));
    await page.locator('[data-page="workshop"]').click();
    await page.locator('#workshop-category').selectOption('weapon');
    await page.locator('#workshop-subcategory').selectOption('rifle');
    await page.locator('#workshop-search').fill('逆战');
    await page.locator('#workshop-form').getByRole('button').click();
    await page.locator('.content-card .workshop-tags').first().waitFor({ timeout: 60000 });
    const cards = await page.locator('.content-card').evaluateAll(elements => elements.map(element => ({ title: element.querySelector('.card-title').textContent, labels: [...element.querySelectorAll('.workshop-tags [data-classification]')].map(tag => ({ label: tag.textContent, source: tag.dataset.source, id: tag.dataset.classification })) })));
    assert.ok(cards.length && cards.every(card => card.labels.length), 'all live search cards show classification labels');
    console.log(JSON.stringify({ liveWeaponLabels: cards.slice(0, 8) }, null, 2));
    fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../output/playwright/workshop-labels-live.png') });
    await page.locator('[data-page="console"]').click();
    await page.waitForFunction(() => ['ready', 'auth', 'error'].includes(document.querySelector('#console-status')?.dataset.status), null, { timeout: 35000 });
    const status = await page.locator('#console-status').textContent();
    const remote = application.context().pages().find(candidate => candidate !== page && /106\.55\.93\.240/.test(candidate.url()));
    assert.equal(await page.locator('#console-status').getAttribute('data-status'), 'ready', status);
    assert.ok(remote, 'real embedded panel must exist');
    assert.equal(new URL(remote.url()).origin, panelUrl.origin);
    assert.match(await remote.title(), /L4D2-Control/);
    const preview = await remote.locator('body').innerText();
    assert.match(preview, /控制台|登录|账号/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'settings.json'))).consoleUrl, panelUrl.href);
    const panel = { status, title: await remote.title(), url: remote.url(), preview: preview.slice(0, 220) };
    console.log(JSON.stringify({ livePanel: panel }, null, 2));
    fs.mkdirSync(path.join(__dirname, '../output'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../output/live-search-console.json'), JSON.stringify({ search: { queries: search.data.search.queries, count: search.data.items.length }, workshopCards: cards, panel }, null, 2));
  } finally { if (application) await application.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

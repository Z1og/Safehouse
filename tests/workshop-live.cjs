// Explicit integration check: temporarily subscribes one small public item,
// installs into a disposable game fixture, then restores subscription state.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { game } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-workshop-live-'));
  const { gameRoot, addons } = game(root), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', autoTranslate: false, language: 'zh-CN' }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.SAFEHOUSE_DISABLE_STEAMWORKS;
  let application, page, mustRestore = false;
  const id = '3825637308';
  async function invoke(method, ...args) {
    const result = await page.evaluate(({ method, args }) => window.safehouse[method](...args), { method, args });
    if (!result.ok) throw new Error(result.error); return result.data;
  }
  try {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env, timeout: 30000 });
    page = await application.firstWindow();
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    assert.equal((await invoke('state')).steam.ugc.ready, true);
    const initial = await invoke('details', id);
    assert.equal(initial.subscribed, false, 'Choose another fixture: this item is already subscribed');
    console.log('PASS live Electron: Steamworks native module loaded; owned app and account connected');
    assert.equal(await page.locator('[data-page="downloads"]').count(), 0);
    await page.locator('[data-page="workshop"]').click();
    await page.locator('#workshop-category').selectOption('weapon');
    await page.locator('#workshop-subcategory').selectOption('rifle');
    const rifles = await invoke('search', '', 1, 'weapon', 'rifle');
    assert.ok(rifles.items.length > 0);
    assert.ok(rifles.items.every(item => item.tags.includes('Weapons') && item.tags.includes('Rifle')));
    await page.locator('.content-card').first().waitFor({ timeout: 35000 });
    assert.ok(await page.locator('.content-card .card-actions button[data-detail]').count() > 0);
    console.log('PASS live workshop: rifle secondary filter matches Steam tags; cards have details and subscription controls');
    await page.locator('#workshop-category').selectOption('survivor');
    await page.locator('#workshop-subcategory').selectOption('nick');
    const nicks = await invoke('search', '', 1, 'survivor', 'nick');
    assert.ok(nicks.items.length > 0);
    assert.ok(nicks.items.every(item => item.tags.includes('Survivors') && item.tags.includes('Nick')));
    console.log('PASS live workshop: Nick secondary filter matches actual community tags');
    await page.locator('#workshop-search').fill(id); await page.getByRole('button', { name: '搜索内容' }).click();
    const card = page.locator('.content-card').filter({ has: page.locator(`[data-detail="${id}"]`) });
    await card.locator('.card-actions [data-detail]').waitFor({ timeout: 30000 });
    await card.locator('.card-actions [data-detail]').click();
    await page.locator('#details-content').getByRole('heading', { name: initial.title, exact: true }).waitFor({ timeout: 30000 });
    await page.locator('[data-action="close-dialog"]').click();
    mustRestore = true;
    await card.locator('[data-action="subscribe-item"]').click();
    assert.equal(await page.locator('[data-page="workshop"]').evaluate(element => element.classList.contains('active')), true);
    await page.locator('.job-icon.completed').waitFor({ timeout: 90000 });
    const state = await invoke('state'), job = state.downloads.find(job => job.workshopId === id);
    assert.equal(job.status, 'completed'); assert.ok(job.bytes > 0);
    assert.ok(fs.existsSync(path.join(addons, `safehouse-workshop-${id}.vpk`)));
    const installed = state.items.find(item => item.workshopId === id && item.source !== 'cache'); assert.ok(installed);
    console.log(`PASS live card subscription -> same-page byte progress -> validated installation (${job.bytes} bytes)`);
    fs.mkdirSync(path.join(__dirname, '../output/playwright'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../output/playwright/workshop-live-download.png') });
    await page.locator('[data-page="library"]').click();
    const installedCard = page.locator('.content-card').filter({ has: page.locator(`[data-toggle="${installed.id}"]`) });
    await installedCard.locator('[data-action="unsubscribe-item"]').waitFor();
    await installedCard.locator('[data-toggle]').click();
    await page.waitForFunction(id => document.querySelector(`[data-toggle="${id}"]`)?.getAttribute('aria-checked') === 'false', installed.id);
    assert.equal((await invoke('details', id)).subscribed, true);
    console.log('PASS local card: subscription is separate from the enable switch');
    await page.screenshot({ path: path.join(__dirname, '../output/playwright/mod-management-subscription.png') });
    await installedCard.locator('[data-action="unsubscribe-item"]').click();
    await page.waitForFunction(id => !document.querySelector(`[data-toggle="${id}"]`), installed.id, { timeout: 30000 });
    assert.equal((await invoke('details', id)).subscribed, false); mustRestore = false;
    assert.ok(!fs.existsSync(path.join(addons, `safehouse-workshop-${id}.vpk`)));
    assert.ok(!(await invoke('state')).items.some(item => item.workshopId === id));
    console.log('PASS live unsubscribe: installed VPK removed to recycle bin, card removed, temporary subscription restored');
    await page.locator('[data-page="workshop"]').click();
    await card.locator('[data-action="subscribe-item"]').waitFor();
    assert.equal(await card.locator('[data-action="unsubscribe-item"]').count(), 0);
    console.log('PASS cross-page subscription state after uninstall');
  } finally {
    if (mustRestore && page && !page.isClosed()) { await invoke('unsubscribe', id); console.log('Restored test subscription in cleanup'); }
    if (application) await application.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

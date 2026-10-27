const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { vpk, game } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-taxonomy-'));
  const { gameRoot, addons } = game(root), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const screenshots = path.join(__dirname, '..', 'output', 'playwright'); fs.mkdirSync(screenshots, { recursive: true });
  const put = (filename, title, resources) => fs.writeFileSync(path.join(addons, filename), vpk({ 'addoninfo.txt': `"AddonInfo" { "addontitle" "${title}" "addonContent_Sound" "1" }`, ...resources }));
  for (const [name, stem] of [['nick', 'gambler'], ['rochelle', 'producer'], ['coach', 'coach'], ['ellis', 'mechanic'], ['bill', 'namvet'], ['zoey', 'teenangst'], ['francis', 'biker'], ['louis', 'manager']]) {
    put(`${name}.vpk`, `Fixture ${name}`, { [`models/survivors/survivor_${stem}.mdl`]: name, [`models/weapons/arms/v_arms_${stem}.mdl`]: 'arms' });
  }
  put('nick-b.vpk', 'Fixture alternate Nick', { 'models/survivors/survivor_gambler.mdl': 'alternate' });
  put('ak-a.vpk', 'Fixture AK A', { 'models/v_models/v_rifle_ak47.mdl': 'ak-a' });
  put('ak-b.vpk', 'Fixture AK B', { 'models/w_models/weapons/w_rifle_ak47.mdl': 'ak-b' });
  put('m16.vpk', 'Fixture M16', { 'models/v_models/v_rifle.mdl': 'm16' });
  put('spas.vpk', 'Fixture SPAS', { 'models/v_models/v_shotgun_spas.mdl': 'spas' });
  put('uzi.vpk', 'Fixture UZI', { 'models/v_models/v_smg.mdl': 'uzi', 'sound/misc/support.wav': 'sound' });
  put('pills.vpk', 'Fixture pills', { 'models/v_models/v_painpills.mdl': 'pills' });
  put('campaign.vpk', 'Fixture campaign with bundled assets', { 'maps/custom.bsp': 'map', 'models/survivors/survivor_gambler.mdl': 'bundled', 'models/v_models/v_rifle.mdl': 'bundled' });
  put('mixed.vpk', 'Fixture combined slots', { 'models/survivors/survivor_gambler.mdl': 'nick', 'models/v_models/v_rifle_ak47.mdl': 'ak' });
  fs.writeFileSync(path.join(gameRoot, 'left4dead2', 'addonlist.txt'), '"AddonList" { "nick-b.vpk" "0" "ak-b.vpk" "0" }');
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', autoTranslate: false, language: 'zh-CN' }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], executablePath: runtime(), env, timeout: 30000 });
  let app;
  try {
    app = await launch(); const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.content-card').first().waitFor();
    assert.equal(await page.locator('.content-card').count(), 17);
    await page.locator('[data-filter="survivor"]').click(); assert.equal(await page.locator('.content-card').count(), 10);
    for (const person of ['nick', 'rochelle', 'coach', 'ellis', 'bill', 'zoey', 'francis', 'louis']) assert.ok(await page.locator(`[data-slot="survivor:${person}"]`).isVisible());
    await page.locator('[data-slot="survivor:nick"]').click(); assert.equal(await page.locator('.content-card').count(), 3);
    assert.ok((await page.locator('.taxonomy-heading').innerText()).includes('已启用 2'));
    await page.locator('#repeated-targets').check(); assert.equal(await page.locator('.content-card').count(), 3);
    await page.locator('.content-card').filter({ has: page.getByRole('button', { name: 'Fixture nick', exact: true }) }).locator('[data-toggle]').click();
    await page.getByRole('heading', { name: '没有找到匹配内容', exact: true }).waitFor();
    assert.ok((await page.locator('.taxonomy-heading').innerText()).includes('已启用 1'));
    await page.locator('#repeated-targets').uncheck(); assert.equal(await page.locator('.content-card').count(), 3);
    await page.locator('.content-card').filter({ has: page.getByRole('button', { name: 'Fixture nick', exact: true }) }).locator('[data-toggle]').click();
    await page.waitForFunction(() => document.querySelector('.taxonomy-heading').textContent.includes('已启用 2'));
    console.log('PASS taxonomy: all eight character slots; multi-target membership; enabled peer counts update after toggling');
    await page.getByRole('button', { name: 'Fixture nick', exact: true }).click();
    await page.getByRole('heading', { name: '替换目标与识别依据', exact: true }).waitFor();
    assert.ok((await page.locator('.detail-targets').innerText()).includes('models/survivors/survivor_gambler.mdl'));
    await page.locator('.detail-targets [data-action="view-target"]').click(); assert.equal(await page.locator('.content-card').count(), 3);
    assert.equal(await page.locator('#details-dialog').evaluate(dialog => dialog.open), false);
    await page.locator('[data-filter="weapon"]').click(); assert.equal(await page.locator('.content-card').count(), 6);
    await page.locator('[data-subfilter="rifle"]').click(); assert.equal(await page.locator('.content-card').count(), 4);
    await page.locator('#library-slot').selectOption('weapon:ak47'); assert.equal(await page.locator('.content-card').count(), 3);
    await page.locator('#library-sort').selectOption('slot');
    await page.locator('[data-layout="list"]').click(); assert.equal(await page.locator('.list-view .content-card').count(), 3);
    await page.locator('[data-filter="disabled"]').click(); assert.equal(await page.locator('.content-card').count(), 2);
    await page.locator('[data-filter="all"]').click(); await page.locator('#library-search').fill('尼克'); assert.equal(await page.locator('.content-card').count(), 3);
    await page.locator('#library-search').fill('');
    await page.locator('[data-filter="map"]').click(); assert.equal(await page.locator('.content-card').count(), 1);
    await page.locator('[data-filter="item"]').click(); assert.equal(await page.locator('.content-card').count(), 1);
    assert.equal(await page.locator('[data-page="conflicts"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS taxonomy: weapon groups -> exact AK slot; detail evidence and same-target navigation; list/search/disabled filters');
    await app.close(); app = null;

    if (process.env.SAFEHOUSE_REAL_LIBRARY_ROOT) {
      // Read the real inventory for classification/screenshots only. No enable,
      // install, uninstall or Steam subscription operation is executed here.
      const real = path.join(root, 'real-profile'); fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, 'settings.json'), JSON.stringify({ gameRoot: process.env.SAFEHOUSE_REAL_LIBRARY_ROOT, theme: 'light', autoTranslate: false, language: 'zh-CN' }));
      env.SAFEHOUSE_DATA_DIR = real; app = await launch(); const live = await app.firstWindow();
      await live.locator('.content-card').first().waitFor();
      await live.locator('[data-filter="survivor"]').click(); assert.equal(await live.locator('.content-card').count(), 8);
      await live.locator('.filterbar').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await live.screenshot({ path: path.join(screenshots, 'taxonomy-real-survivors.png') });
      for (const name of ['nick', 'rochelle', 'coach', 'ellis', 'bill', 'zoey', 'francis', 'louis']) {
        await live.locator(`[data-slot="survivor:${name}"]`).click(); assert.equal(await live.locator('.content-card').count(), 1);
      }
      await live.locator('[data-filter="weapon"]').click(); assert.equal(await live.locator('.content-card').count(), 5);
      await live.locator('.filterbar').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await live.screenshot({ path: path.join(screenshots, 'taxonomy-real-weapons.png') });
      for (const id of ['uzi', 'm16', 'm60', 'spas', 'autoshotgun']) {
        await live.locator('#library-slot').selectOption(`weapon:${id}`); assert.equal(await live.locator('.content-card').count(), 1);
      }
      console.log('PASS real read-only inventory: eight survivors map one-to-one; all five guns map to their exact replacement slot');
    }
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

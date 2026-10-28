// Read-only public Steam integration check. Never changes real subscriptions.
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { game, vpk } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-collections-live-'));
  const { gameRoot, addons } = game(root), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  fs.writeFileSync(path.join(addons, 'safehouse-workshop-3260067578.vpk'), vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Public collection lookup fixture" }', 'materials/fixture.vmt': 'fixture' }));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', autoTranslate: false, language: 'zh-CN' }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env });
    const page = await application.firstWindow(); await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await page.locator('[data-action="open-collections"]').click();
    const dialog = page.locator('#collections-dialog'); await dialog.locator('.collection-row').first().waitFor({ timeout: 35000 });
    const parents = await page.evaluate(() => window.safehouse.collections('3260067578', 2));
    assert.equal(parents.ok, true, parents.error); assert.equal(parents.data.page, 2); assert.ok(parents.data.items.length);
    const count = await dialog.locator('.collection-row').count();
    await dialog.getByRole('button', { name: '查看成员', exact: true }).first().click();
    await dialog.locator('.collection-row').first().waitFor({ timeout: 35000 });
    assert.ok(await dialog.locator('[data-action="subscribe-item"]').first().isDisabled());
    const members = await page.evaluate(() => window.safehouse.collectionMembers('3140149743'));
    assert.equal(members.ok, true, members.error); assert.equal(members.data.items[0].id, '3260067578'); assert.ok(members.data.total >= 30);
    const output = path.join(__dirname, '../output/playwright'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'collections-live.png') });
    console.log(JSON.stringify({ pass: 'native public collections and member IPC/UI; offline Steam controls disabled; no subscription changes', parentPageSize: count, secondPageSize: parents.data.items.length, knownCollection: members.data.collection.title, members: members.data.total }));
  } finally {
    if (application) await application.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

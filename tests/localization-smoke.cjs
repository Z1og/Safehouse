const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { vpk, game } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-localization-smoke-'));
  const { gameRoot, addons } = game(root), profile = path.join(root, 'profile'), directory = path.join(profile, 'panel-downloads');
  fs.mkdirSync(directory, { recursive: true }); fs.mkdirSync(path.join(addons, 'workshop'));
  const make = name => vpk({ 'addoninfo.txt': `"AddonInfo" { "addontitle" "${name}" }`, 'models/survivors/survivor_gambler.mdl': name });
  const source = path.join(addons, 'safehouse-workshop-9876543210123.vpk'), data = make('保留角色测试'); fs.writeFileSync(source, data);
  fs.writeFileSync(path.join(addons, 'workshop', '9876543210456.vpk'), make('批量本地化甲'));
  fs.writeFileSync(path.join(addons, 'safehouse-workshop-9876543210789.vpk'), make('批量本地化乙'));
  fs.writeFileSync(path.join(addons, 'ordinary.vpk'), make('普通本地模组'));
  const panelId = crypto.randomUUID(), importId = crypto.randomUUID(), workshopId = crypto.randomUUID();
  const residual = path.join(directory, '面板下载失败测试.vpk'), importFile = path.join(root, '原始导入保留.vpk');
  fs.writeFileSync(residual, data.subarray(0, 10)); fs.writeFileSync(importFile, data);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: false }));
  fs.writeFileSync(path.join(profile, 'downloads.json'), JSON.stringify([
    { id: panelId, kind: 'panel', title: '面板下载失败测试.vpk', input: residual, status: 'failed', error: '测试直链已失效' },
    { id: importId, kind: 'import', title: '原始导入保留.vpk', input: importFile, status: 'failed', error: '测试安装失败' },
    { id: workshopId, kind: 'workshop', workshopId: '9876543210999', title: '工坊失败记录测试', status: 'failed', error: '测试接口不可用' },
  ]));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  const launch = () => electron.launch({ args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], executablePath: runtime(), env, timeout: 30000 });
  try {
    application = await launch(); const page = await application.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await application.evaluate(({ app }) => {
      const { Workshop } = process.mainModule.require('./core/workshop');
      globalThis.fixtureSubscriptions = ['9876543210123', '9876543210456', '9876543210789'];
      Workshop.prototype.status = function () { return { ready: true, subscribedIds: [...globalThis.fixtureSubscriptions], account: { steamId: '76561190000000000', name: 'Fixture Steam Account' } }; };
      Workshop.prototype.unsubscribe = async function (id) { globalThis.fixtureSubscriptions = globalThis.fixtureSubscriptions.filter(value => value !== id); return { id, subscribed: false }; };
    });
    await page.locator('[data-action="scan"]').first().click();
    await page.waitForFunction(async () => (await window.safehouse.state()).data.steam.ugc.ready);
    const failed = page.locator('.job').filter({ has: page.getByRole('heading', { name: '面板下载失败测试.vpk', exact: true }) });
    await failed.getByRole('button', { name: '删除文件及记录', exact: true }).click();
    await failed.waitFor({ state: 'detached' });
    assert.ok(!fs.existsSync(residual));
    const expandTransfers = async () => { const toggle = page.locator('[data-action="toggle-transfers"]'); if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click(); };
    await expandTransfers();
    await page.locator('.job').filter({ has: page.getByRole('heading', { name: '原始导入保留.vpk', exact: true }) }).getByRole('button', { name: '删除记录', exact: true }).click();
    await page.locator('.job').filter({ has: page.getByRole('heading', { name: '原始导入保留.vpk', exact: true }) }).waitFor({ state: 'detached' });
    assert.deepEqual(fs.readFileSync(importFile), data);
    await page.locator('.job').filter({ has: page.getByRole('heading', { name: '工坊失败记录测试', exact: true }) }).getByRole('button', { name: '删除记录', exact: true }).click();
    await page.locator('.job').filter({ has: page.getByRole('heading', { name: '工坊失败记录测试', exact: true }) }).waitFor({ state: 'detached' });
    console.log('PASS native failed-task cleanup: panel residual recycled; import original and subscriptions preserved');

    const original = page.locator('.content-card').filter({ has: page.locator('[data-action="localize-item"]') }).filter({ hasText: '保留角色测试' });
    await original.getByRole('button', { name: '本地化', exact: true }).click();
    await original.getByRole('button', { name: '已本地化', exact: true }).waitFor();
    await page.locator('.localization-badge').waitFor();
    const state = (await page.evaluate(() => window.safehouse.state())).data;
    const copy = state.items.find(item => item.localized && item.originWorkshopId === '9876543210123');
    assert.ok(copy.enabled); assert.equal(state.items.find(item => item.file === source).enabled, false);
    assert.deepEqual(fs.readFileSync(copy.file), data);
    await original.getByRole('button', { name: '取消订阅', exact: true }).click();
    await page.waitForFunction(async () => !(await window.safehouse.state()).data.items.some(item => item.workshopId === '9876543210123'));
    assert.ok(!fs.existsSync(source)); assert.deepEqual(fs.readFileSync(copy.file), data);
    console.log('PASS native localization: independent copy enabled, workshop copy disabled then removed on fixture unsubscribe');

    for (const name of ['批量本地化甲', '批量本地化乙']) {
      await page.locator('.content-card').filter({ has: page.getByRole('button', { name, exact: true }) }).locator('[data-select]').check();
    }
    await page.getByRole('button', { name: '本地化所选', exact: true }).click();
    await page.waitForFunction(async () => (await window.safehouse.state()).data.items.filter(item => item.localized).length === 3);
    fs.rmSync(path.join(addons, 'workshop', '9876543210456.vpk'));
    fs.rmSync(path.join(addons, 'safehouse-workshop-9876543210789.vpk'));
    await page.locator('[data-action="scan"]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.localization-badge').length === 3);
    const screenshot = path.join(__dirname, '..', 'output', 'playwright', 'localization-and-cleanup.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.locator('#library-content').scrollIntoViewIfNeeded(); await page.screenshot({ path: screenshot });
    assert.deepEqual(errors, []); console.log('PASS native bulk localization: three retained copies survive simulated Steam file cleanup; no renderer errors');
    await application.close(); application = await launch(); const reopened = await application.firstWindow();
    await reopened.waitForFunction(() => document.querySelectorAll('.localization-badge').length === 3);
    const restored = (await reopened.evaluate(() => window.safehouse.state())).data;
    assert.equal(restored.items.filter(item => item.localized).length, 3); assert.equal(restored.downloads.length, 0);
    assert.ok(restored.items.find(item => item.file === copy.file).enabled); assert.deepEqual(fs.readFileSync(copy.file), data);
    console.log('PASS native restart: localized metadata, bytes, enable states and deleted task records persist');
  } finally {
    if (application) await application.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

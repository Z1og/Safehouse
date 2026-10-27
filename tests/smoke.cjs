const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { vpk, game } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-smoke-'));
  const { gameRoot, addons } = game(root), userData = path.join(root, 'profile'); fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', autoTranslate: false, language: 'zh-CN' }));
  fs.writeFileSync(path.join(addons, 'one.vpk'), vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Smoke Map One" }', 'maps/shared.bsp': 'one' }));
  fs.writeFileSync(path.join(addons, 'two.vpk'), vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Smoke Map Two" }', 'maps/shared.bsp': 'two' }));
  fs.writeFileSync(path.join(gameRoot, 'left4dead2', 'addonlist.txt'), '"AddonList" { "one.vpk" "0" "two.vpk" "1" }');
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: userData, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await electron.launch({ args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], executablePath: runtime(), env, timeout: 30000 });
    const page = await application.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    assert.equal(await page.locator('.content-card').count(), 2);
    assert.equal(await page.locator('.content-card [data-action="delete-local"]').count(), 2);
    const oldClipboard = await application.evaluate(({ clipboard }) => clipboard.readText());
    try {
      await page.locator('[data-action="project-group"]').click();
      await page.locator('#toast').filter({ hasText: 'QQ群号 1002677414 已复制' }).waitFor();
      assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), '1002677414');
    } finally { await application.evaluate(({ clipboard }, value) => clipboard.writeText(value), oldClipboard); }
    console.log('PASS native community action: QQ group number copied and original clipboard restored');
    assert.equal(await page.locator('[data-page="conflicts"]').count(), 0);
    assert.equal(await page.locator('[data-action="login"]').count(), 0);
    console.log('PASS native UI: local library without conflict or web-login controls');
    await page.locator('[data-page="library"]').click();
    await page.locator('[data-filter="disabled"]').click(); assert.equal(await page.locator('.content-card').count(), 1);
    await page.locator('[data-toggle]').click();
    await page.getByRole('heading', { name: '没有找到匹配内容' }).waitFor();
    console.log('PASS native UI: disabled filter -> enable -> item leaves disabled results');
    await page.locator('[data-filter="all"]').click();
    await page.locator('#select-all').check(); await page.locator('[data-action="bulk-disable"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-toggle][aria-checked="false"]').length === 2);
    await page.locator('[data-action="bulk-enable"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-toggle][aria-checked="true"]').length === 2);
    await page.locator('#select-all').uncheck();
    console.log('PASS native IPC: bulk disable and enable persist to the game addonlist');

    const local = path.join(root, 'imported.vpk'), archive = path.join(root, 'bundle.zip');
    fs.writeFileSync(local, vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "测试导入地图" }', 'maps/imported.bsp': 'local fixture' }));
    const zip = new yazl.ZipFile();
    zip.addBuffer(vpk({ 'maps/zip-one.bsp': 'first' }), 'nested/zip-one.vpk');
    zip.addBuffer(vpk({ 'maps/zip-two.bsp': 'second' }), 'zip-two.vpk');
    const writing = pipeline(zip.outputStream, fs.createWriteStream(archive)); zip.end(); await writing;
    await application.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [local, archive]);
    await page.locator('[data-action="import"]').first().click();
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.job-icon.completed').length === 2);
    for (const name of ['imported.vpk', 'zip-one.vpk', 'zip-two.vpk']) assert.ok(fs.existsSync(path.join(addons, name)));
    console.log('PASS native IPC: file-picker import installs one VPK and a nested ZIP containing two VPKs');
    await page.locator('#main [data-action="import"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.job-icon.failed').length === 2);
    assert.equal(fs.readdirSync(addons).filter(name => name.endsWith('.vpk')).length, 5);
    console.log('PASS native IPC: duplicate imports fail without overwriting installed files');
    await page.locator('[data-action="clear-downloads"]').click();
    await page.waitForFunction(() => !document.querySelector('.transfer-panel'));
    await page.locator('[data-page="library"]').click();
    const importedCard = page.locator('.content-card').filter({ has: page.getByRole('button', { name: '测试导入地图', exact: true }) });
    await importedCard.locator('[data-select]').check();
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async (_window, options) => { globalThis.deleteConfirmation = options; return { response: 0 }; }; });
    await importedCard.locator('[data-action="delete-local"]').click();
    await page.waitForFunction(async () => (await window.safehouse.state()).data.items.length === 5);
    const confirmation = await application.evaluate(() => globalThis.deleteConfirmation);
    assert.ok(confirmation.detail.includes('测试导入地图'));
    assert.ok(confirmation.detail.includes('原始导入文件不受影响'));
    assert.equal(confirmation.defaultId, 0);
    assert.ok(fs.existsSync(path.join(addons, 'imported.vpk')));
    assert.ok(await importedCard.locator('[data-select]').isChecked());
    console.log('PASS single delete: cancel keeps the installed file and current selection');

    await application.evaluate(({ dialog, shell }) => {
      globalThis.realTrashItem = shell.trashItem;
      dialog.showMessageBox = async () => ({ response: 1 });
      shell.trashItem = async () => { throw new Error('fixture file in use'); };
    });
    await importedCard.locator('[data-action="delete-local"]').click();
    await page.locator('#toast').filter({ hasText: 'fixture file in use' }).waitFor();
    assert.ok(fs.existsSync(path.join(addons, 'imported.vpk')));
    assert.equal(await page.locator('.content-card').count(), 5);
    await application.evaluate(({ shell }) => { shell.trashItem = globalThis.realTrashItem; });
    console.log('PASS single delete: trash failure is visible and retains the installed mod');

    await page.locator('[data-layout="list"]').click();
    await importedCard.locator('[data-action="delete-local"]').waitFor({ state: 'visible' });
    await importedCard.locator('[data-detail]').last().click();
    await page.locator('#details-dialog[open] [data-action="delete-local"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.content-card').length === 4 && !document.querySelector('#details-dialog').open);
    assert.ok(!fs.existsSync(path.join(addons, 'imported.vpk')));
    assert.ok(fs.existsSync(local));
    assert.equal(await page.locator('[data-action="bulk-uninstall"]').count(), 0);
    assert.equal((await page.evaluate(() => window.safehouse.state())).data.items.length, 4);
    await page.locator('[data-layout="grid"]').click();
    console.log('PASS single delete: list/detail controls, real recycle bin, original source retained, modal and selection refreshed');

    await page.locator('.content-card').filter({ has: page.getByRole('button', { name: 'Smoke Map One', exact: true }) }).locator('[data-select]').check();
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.locator('[data-action="bulk-uninstall"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.content-card').length === 3);
    assert.ok(!fs.existsSync(path.join(addons, 'one.vpk')));
    console.log('PASS native IPC: uninstall moves a selected temporary VPK to the real Windows recycle bin');
    await page.locator('.nav[data-page="settings"]').click();
    await page.getByRole('heading', { name: 'Steam 本地状态' }).waitFor();
    assert.equal(await page.locator('[data-action="login"]').count(), 0);
    await page.locator('#theme-select').selectOption('dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'))).theme, 'dark');
    console.log('PASS native UI: persisted dark theme');
    await page.locator('[data-page="workshop"]').click();
    await page.locator('.workshop-note').filter({ hasText: '公开浏览无需登录' }).waitFor();
    await page.locator('#workshop-category').selectOption('weapon');
    await page.locator('.workshop-note').filter({ hasText: '公开浏览无需登录' }).waitFor();
    console.log('PASS native UI: public workshop browsing and category filter');
    await page.locator('[data-page="library"]').click(); await page.waitForFunction(() => !document.querySelector('.transfer-panel'));
    assert.deepEqual(errors, []); console.log('PASS renderer: no uncaught JavaScript errors');
    if (process.env.SAFEHOUSE_SMOKE_SHOT) {
      fs.mkdirSync(path.dirname(path.resolve(process.env.SAFEHOUSE_SMOKE_SHOT)), { recursive: true });
      await page.locator('[data-page="library"]').click(); await page.locator('[data-filter="all"]').click();
      await page.screenshot({ path: path.resolve(process.env.SAFEHOUSE_SMOKE_SHOT) });
    }
    await application.close(); application = null;
    application = await electron.launch({ args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], executablePath: runtime(), env, timeout: 30000 });
    const reopened = await application.firstWindow();
    await reopened.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.querySelectorAll('.content-card').length === 3);
    console.log('PASS native restart: library and dark theme survive process restart');
  } finally {
    if (application) await application.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { runtime } = require('./runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-preview-'));
  const output = path.resolve(__dirname, '../output/playwright');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ gameRoot: '', theme: 'light', autoTranslate: false, language: 'zh-CN' }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: root }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    application = await electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env, timeout: 30000 });
    const page = await application.firstWindow();
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    await page.locator('.content-card').first().waitFor();
    // Only read the real library. All file-changing checks belong to smoke.cjs.
    const inventory = await page.evaluate(async () => (await window.safehouse.state()).data);
    await page.locator('[data-filter="survivor"]').click();
    await page.locator('.filterbar').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(output, 'safehouse-library.png') });
    await page.locator('[data-page="workshop"]').click();
    await page.locator('#workshop-category').selectOption('weapon');
    await page.locator('#workshop-subcategory').selectOption('rifle');
    await page.locator('.content-card').first().waitFor({ timeout: 40000 });
    await page.waitForFunction(() => [...document.querySelectorAll('#workshop-content .cover img')].slice(0, 3).every(image => image.complete && image.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: path.join(output, 'safehouse-workshop.png') });
    await page.locator('.nav[data-page="settings"]').click();
    await page.screenshot({ path: path.join(output, 'safehouse-settings.png') });
    await application.browserWindow(page).then(window => window.evaluate(win => win.setSize(1000, 750)));
    await page.locator('[data-page="library"]').click();
    await page.screenshot({ path: path.join(output, 'safehouse-compact.png') });
    const result = { gameRoot: inventory.gameRoot, items: inventory.items.length, invalid: inventory.items.filter(item => item.error).length, output };
    if (process.env.SAFEHOUSE_CHECK_NETWORK === '1') {
      for (const [name, method, args] of [['workshop', 'search', ['', 1, 'all']], ['translation', 'translate', ['Custom campaign for Left 4 Dead 2']]]) {
        const response = await page.evaluate(async ({ method, args }) => window.safehouse[method](...args), { method, args });
        result[name] = !response.ok ? { ok: false, error: response.error } : name === 'workshop' ? { ok: true, items: response.data.items.length, hasMore: response.data.hasMore } : { ok: true, ...response.data };
      }
    }
    fs.writeFileSync(path.join(output, 'preview-verification.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (application) await application.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

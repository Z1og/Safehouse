const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { game, vpk } = require('./fixtures.cjs');
const { runtime } = require('../scripts/runtime.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-favorites-smoke-'));
  const { gameRoot, addons } = game(root), profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const installed = path.join(addons, 'safehouse-workshop-88.vpk');
  const bytes = vpk({ 'addoninfo.txt': '"AddonInfo" { "addontitle" "Installed AK-47" }', 'models/weapons/v_rifle_ak47.mdl': 'fixture' });
  fs.writeFileSync(installed, bytes);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ gameRoot, theme: 'light', language: 'zh-CN', autoTranslate: true }));
  const env = { ...process.env, SAFEHOUSE_DATA_DIR: profile, SAFEHOUSE_DISABLE_STEAMWORKS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ executablePath: runtime(), args: process.env.SAFEHOUSE_PACKAGED === '1' ? [] : [path.join(__dirname, '..')], env });
  let application, page; const errors = [];
  const card = id => page.locator('.content-card').filter({ has: page.locator(`.card-title[data-detail="${id}"]`) });
  const navigate = name => page.locator(`[data-page="${name}"]`).click();
  const count = async expected => { await page.waitForFunction(expected => document.querySelector('#favorites-count').textContent === String(expected), expected); };
  const current = async number => { await page.locator(`.page-number[aria-current="page"][data-number="${number}"]`).waitFor(); };
  try {
    application = await launch(); page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor();
    const addonList = path.join(gameRoot, 'left4dead2', 'addonlist.txt'), originalList = fs.existsSync(addonList) ? fs.readFileSync(addonList) : null;
    await application.evaluate(() => {
      const { Community } = process.mainModule.require('./core/community'), { Translator } = process.mainModule.require('./core/translator'), { Workshop } = process.mainModule.require('./core/workshop');
      globalThis.favoriteFixture = { search: [], waiting: [], hold: true, steamCalls: 0, offline: false };
      const items = page => [
        { id: String((page - 1) * 3 + 1), title: `Fixture AK-47 ${page}`, author: 'Fixture Creator', tags: ['Weapons', 'Rifle'], description: 'Replaces AK-47.' },
        { id: String((page - 1) * 3 + 2), title: `Fixture Maid for Nick ${page}`, author: 'Fixture Creator', tags: ['Survivors', 'Nick'], description: 'Replaces Nick.' },
        { id: String((page - 1) * 3 + 3), title: `Fixture Campaign ${page}`, author: 'Fixture Creator', tags: ['Campaigns', 'Co-op'], description: 'A co-op campaign.' },
      ];
      Community.prototype.search = async function (query, page, category, subcategory) { globalThis.favoriteFixture.search.push({ query, page, category, subcategory }); return { items: page <= 40 ? items(page) : [], page, totalPages: 40, hasMore: page < 40 }; };
      Community.prototype.details = async function (id) { if (globalThis.favoriteFixture.offline) throw Error('fixture offline'); return items(Math.floor((Number(id) - 1) / 3) + 1).find(item => item.id === id); };
      Workshop.prototype.status = function () { return { ready: true, subscribedIds: ['88'], account: { steamId: '76561190000000000', name: 'Fixture Account' } }; };
      Workshop.prototype.subscribe = Workshop.prototype.unsubscribe = async function () { globalThis.favoriteFixture.steamCalls++; throw Error('Bookmark must not invoke Steam'); };
      Translator.prototype.translate = async function (text) { if (globalThis.favoriteFixture.hold) await new Promise(resolve => globalThis.favoriteFixture.waiting.push(resolve)); return { text: '译文 ' + text, language: 'zh-CN', provider: 'Bing' }; };
    });
    await navigate('workshop'); await current(1);
    await page.getByRole('button', { name: '下一页', exact: true }).click(); await current(2);
    await page.locator('.page-number[data-number="3"]').click(); await current(3);
    await page.getByRole('spinbutton', { name: '工坊页码', exact: true }).fill('30');
    await page.getByRole('spinbutton', { name: '工坊页码', exact: true }).press('Enter'); await current(30);
    await card('88').getByRole('button', { name: '收藏', exact: true }).click(); await count(1);
    await card('89').getByRole('button', { name: '收藏', exact: true }).click(); await count(2);
    await card('90').getByRole('button', { name: '收藏', exact: true }).click(); await count(3);
    assert.ok(await application.evaluate(() => globalThis.favoriteFixture.waiting.length > 0));
    console.log('PASS native pagination: next, clickable page, typed jump and favorites remain responsive while translations are blocked');
    await page.getByRole('spinbutton', { name: '工坊页码', exact: true }).fill('1001');
    await page.getByRole('button', { name: '跳转', exact: true }).click(); await current(30);
    assert.equal((await application.evaluate(() => globalThis.favoriteFixture.search)).length, 4);
    await page.getByRole('spinbutton', { name: '工坊页码', exact: true }).fill('40');
    await page.getByRole('button', { name: '跳转', exact: true }).click(); await current(40);
    assert.ok(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled());
    await page.getByRole('button', { name: '上一页', exact: true }).click(); await current(39);
    await page.locator('.page-number[data-number="1"]').click(); await current(1);
    assert.ok(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled());
    console.log('PASS native pagination: invalid input does not fetch; known totals and first/last boundaries work');
    await navigate('favorites'); await page.getByRole('heading', { name: '我的收藏', exact: true }).waitFor();
    assert.equal(await page.locator('.content-card').count(), 3);
    assert.equal(await page.locator('#favorites-content [data-action="unsubscribe-item"], #favorites-content [data-action="subscribe-item"]').count(), 0);
    await page.getByRole('combobox', { name: '收藏分类', exact: true }).selectOption('weapon');
    await page.getByRole('combobox', { name: '收藏细分类', exact: true }).selectOption('rifle');
    await page.getByRole('combobox', { name: '收藏具体替换目标', exact: true }).selectOption('weapon:ak47');
    assert.equal(await page.locator('.content-card').count(), 1);
    await card('88').getByRole('button', { name: '移除收藏', exact: true }).click(); await count(2);
    assert.deepEqual(fs.readFileSync(installed), bytes);
    if (originalList) assert.deepEqual(fs.readFileSync(addonList), originalList); else assert.ok(!fs.existsSync(addonList));
    const actual = await page.evaluate(() => window.safehouse.state());
    assert.ok(actual.data.steam.ugc.subscribedIds.includes('88')); assert.ok(actual.data.items.some(item => item.workshopId === '88'));
    assert.equal(await application.evaluate(() => globalThis.favoriteFixture.steamCalls), 0);
    console.log('PASS native favorites: removing an installed favorite leaves its VPK, enabled state, subscription and download state intact');
    await page.getByRole('combobox', { name: '收藏分类', exact: true }).selectOption('survivor');
    await page.getByRole('combobox', { name: '收藏细分类', exact: true }).selectOption('nick');
    await page.getByRole('combobox', { name: '收藏具体替换目标', exact: true }).selectOption('survivor:nick');
    await page.getByRole('searchbox', { name: '搜索我的收藏', exact: true }).fill('尼克');
    assert.equal(await page.locator('.content-card').count(), 1);
    await application.evaluate(() => { globalThis.favoriteFixture.offline = true; globalThis.favoriteFixture.hold = false; globalThis.favoriteFixture.waiting.splice(0).forEach(resolve => resolve()); });
    await card('89').getByRole('button', { name: '详情', exact: true }).click();
    await page.locator('#details-dialog h2').filter({ hasText: 'Fixture Maid for Nick 30' }).waitFor();
    await page.locator('#details-dialog .dialog-close').click();
    console.log('PASS native favorites: exact character filters and bilingual local search work; offline details retain saved metadata');
    await application.close(); application = await launch(); page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '模组管理', exact: true }).waitFor(); await count(2); await navigate('favorites');
    assert.equal(await page.locator('.content-card').count(), 2); assert.deepEqual(fs.readFileSync(installed), bytes);
    await page.evaluate(async () => { for (let index = 0; index < 31; index++) { const result = await window.safehouse.favoriteAdd({ id: String(1000 + index), title: `Saved AK-47 ${index}`, tags: ['Weapons', 'Rifle'], description: 'Replaces AK-47.' }); if (!result.ok) throw Error(result.error); } });
    await navigate('library'); await page.locator('[data-action="scan"]').click(); await count(33); await navigate('favorites');
    await current(1); await page.getByRole('button', { name: '下一页', exact: true }).click(); await current(2);
    assert.equal(await page.locator('.content-card').count(), 3);
    await page.getByRole('spinbutton', { name: '收藏页码', exact: true }).fill('1');
    await page.getByRole('spinbutton', { name: '收藏页码', exact: true }).press('Enter'); await current(1);
    const output = path.join(__dirname, '../output/playwright'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'favorites-desktop.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 700));
    await page.screenshot({ path: path.join(output, 'favorites-compact.png') });
    assert.equal(await page.evaluate(() => document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS native restart: favorites and classifications persist; local pagination, 980px layout and renderer errors checked');
  } finally {
    if (application) { await application.evaluate(() => globalThis.favoriteFixture?.waiting.splice(0).forEach(resolve => resolve())).catch(() => {}); await application.close(); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

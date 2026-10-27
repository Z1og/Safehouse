const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Library } = require('../core/library');
const { Localizations } = require('../core/localization');
const { vpk, game } = require('./fixtures.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-localize-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const { gameRoot, addons } = game(root), stateDir = path.join(root, 'profile');
  const library = new Library({ gameRoot });
  const localizations = new Localizations({ stateDir, library });
  return { root, gameRoot, addons, stateDir, library, localizations, addonList: path.join(gameRoot, 'left4dead2', 'addonlist.txt') };
}
const packageData = name => vpk({ 'addoninfo.txt': `"AddonInfo" { "addontitle" "${name}" }`, 'models/survivors/survivor_gambler.mdl': name });

test('localization copies every installed VPK of a selected project and preserves enable states after Steam cleanup', async t => {
  const f = setup(t), workshop = path.join(f.addons, 'workshop'); fs.mkdirSync(workshop);
  const first = path.join(workshop, '123.vpk'), second = path.join(f.addons, 'safehouse-workshop-123-2.vpk');
  const a = packageData('Enabled Nick'), b = packageData('Disabled Nick');
  fs.writeFileSync(first, a); fs.writeFileSync(second, b);
  fs.writeFileSync(f.addonList, '"AddonList" { "workshop\\\\123.vpk" "1" "safehouse-workshop-123-2.vpk" "0" }');
  const chosen = f.library.scan().items.find(item => item.file === first);
  const result = await f.localizations.localize([chosen.id]);
  assert.equal(result.created, 2); assert.equal(result.retained, 2);
  const inventory = f.localizations.decorate(f.library.scan()), copies = inventory.items.filter(item => item.localized);
  assert.equal(copies.length, 2); assert.equal(copies.filter(item => item.enabled).length, 1);
  assert.ok(copies.every(item => path.dirname(item.file) === f.addons && item.workshopId === '' && item.originWorkshopId === '123'));
  assert.ok(inventory.items.filter(item => item.workshopId === '123').every(item => !item.enabled));
  // Modifying or deleting Steam's files must not modify the independent copies.
  fs.writeFileSync(first, 'Steam rewrote this cache'); fs.rmSync(first); fs.rmSync(second);
  const reloaded = new Localizations({ stateDir: f.stateDir, library: new Library({ gameRoot: f.gameRoot }) });
  const retained = reloaded.retained('123'); assert.equal(retained.length, 2);
  assert.deepEqual(fs.readFileSync(retained.find(item => item.title === 'Enabled Nick').file), a);
  assert.deepEqual(fs.readFileSync(retained.find(item => item.title === 'Disabled Nick').file), b);
  assert.deepEqual(reloaded.decorate(reloaded.library.scan()).localizedWorkshopIds, ['123']);
});

test('repeat localization deduplicates identical VPKs and preserves manual enable decisions', async t => {
  const f = setup(t), data = packageData('Duplicate');
  fs.writeFileSync(path.join(f.addons, 'safehouse-workshop-123.vpk'), data);
  fs.mkdirSync(path.join(f.addons, 'workshop')); fs.writeFileSync(path.join(f.addons, 'workshop', '123.vpk'), data);
  const id = f.library.scan().items.find(item => item.workshopId === '123').id;
  assert.equal((await f.localizations.localize([id])).created, 1);
  const copy = f.localizations.retained('123')[0]; f.library.setEnabled([copy.id], false);
  assert.equal((await f.localizations.localize([id])).created, 0);
  assert.equal(f.localizations.retained('123').length, 1); assert.equal(f.localizations.retained('123')[0].enabled, false);
  assert.ok(!fs.readdirSync(f.addons).some(name => name.startsWith('.safehouse-localize-')));
});

test('invalid selection, incomplete packages and conflicting filenames leave original files and addonlist untouched', async t => {
  const f = setup(t), data = packageData('Conflict'), original = path.join(f.addons, 'safehouse-workshop-123.vpk');
  fs.writeFileSync(original, data); fs.writeFileSync(f.addonList, '"AddonList" { "safehouse-workshop-123.vpk" "1" }');
  const listBefore = fs.readFileSync(f.addonList), id = f.library.scan().items[0].id;
  await assert.rejects(f.localizations.localize(['missing']), /变化/);
  const collision = `safehouse-local-123-${crypto.createHash('sha256').update(data).digest('hex').slice(0, 24)}.vpk`;
  fs.writeFileSync(path.join(f.addons, collision), 'unrelated user file');
  await assert.rejects(f.localizations.localize([id]), /同名/);
  assert.equal(fs.readFileSync(path.join(f.addons, collision), 'utf8'), 'unrelated user file');
  assert.deepEqual(fs.readFileSync(original), data); assert.deepEqual(fs.readFileSync(f.addonList), listBefore);
  fs.writeFileSync(path.join(f.addons, 'safehouse-workshop-123-2.vpk'), 'broken');
  await assert.rejects(f.localizations.localize([id]), /损坏/);
  assert.deepEqual(fs.readFileSync(f.addonList), listBefore);
});

test('failed persistence rolls back published copies and leaves the original enable configuration intact', async t => {
  const f = setup(t), file = path.join(f.addons, 'safehouse-workshop-123.vpk');
  fs.writeFileSync(file, packageData('Rollback'));
  fs.writeFileSync(f.addonList, '"AddonList" { "safehouse-workshop-123.vpk" "1" }');
  const before = fs.readFileSync(f.addonList); f.localizations.store = path.join(f.stateDir, 'missing-folder', 'records.json');
  await assert.rejects(f.localizations.localize([f.library.scan().items[0].id]));
  assert.deepEqual(fs.readdirSync(f.addons), ['safehouse-workshop-123.vpk']);
  assert.deepEqual(fs.readFileSync(f.addonList), before); assert.deepEqual(f.localizations.records, []);
});

test('a modified localized copy is never overwritten and deleting a copy removes its preserved status', async t => {
  const f = setup(t), file = path.join(f.addons, 'safehouse-workshop-123.vpk'); fs.writeFileSync(file, packageData('Original'));
  const id = f.library.scan().items[0].id; await f.localizations.localize([id]);
  const copy = f.localizations.retained('123')[0]; fs.writeFileSync(copy.file, packageData('User edit'));
  await assert.rejects(f.localizations.localize([id]), /发生变化/);
  assert.equal(f.localizations.retained('123')[0].title, 'User edit');
  await f.library.uninstall([copy.id], async target => fs.rmSync(target));
  assert.deepEqual(f.localizations.decorate(f.library.scan()).localizedWorkshopIds, []);
});

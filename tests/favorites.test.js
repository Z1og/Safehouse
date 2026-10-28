const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Favorites, snapshot } = require('../core/favorites');
const { describe } = require('../renderer/workshop-labels');
const { matches } = require('../renderer/favorite-filters');
const { game, vpk } = require('./fixtures.cjs');
const { Library } = require('../core/library');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safehouse-favorites-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, favorites: new Favorites({ stateDir: root }) };
}
const item = (id = '1') => ({ id, title: 'AK-47 replacement', tags: ['Weapons', 'Rifle'], author: 'Public creator', description: 'Replaces AK-47.', image: 'https://example.com/preview.jpg' });
test('favorites are independent public snapshots, deduplicated by ID and persistent across restarts', t => {
  const { root, favorites } = setup(t);
  assert.deepEqual(favorites.list(), []);
  favorites.add({ ...item('01'), subscribed: true, installed: true, file: 'private.vpk', account: 'private' });
  const first = favorites.list()[0];
  favorites.add({ ...item('1'), title: 'Updated title', description: '', tags: [] });
  assert.equal(favorites.list().length, 1); assert.equal(favorites.list()[0].savedAt, first.savedAt);
  assert.equal(favorites.list()[0].description, first.description); assert.deepEqual(favorites.list()[0].tags, first.tags);
  assert.ok(!fs.readFileSync(favorites.file, 'utf8').includes('private'));
  assert.deepEqual(new Favorites({ stateDir: root }).list(), favorites.list());
  const clone = favorites.list(); clone[0].tags.push('Changed externally'); assert.deepEqual(favorites.list()[0].tags, first.tags);
});
test('removing an installed favorite changes only its bookmark and leaves game VPK, enable state and subscription data intact', t => {
  const { root, favorites } = setup(t), { gameRoot, addons } = game(root);
  fs.writeFileSync(path.join(addons, '1.vpk'), vpk({ 'models/weapons/v_rifle_ak47.mdl': 'test' }));
  const library = new Library({ gameRoot }); library.setEnabled(library.scan().items.map(value => value.id), true);
  const settings = path.join(root, 'settings.json'), subscriptions = path.join(root, 'subscription-fixture.json');
  fs.writeFileSync(settings, JSON.stringify({ gameRoot })); fs.writeFileSync(subscriptions, '["1"]');
  const files = [settings, subscriptions, path.join(addons, '1.vpk'), path.join(gameRoot, 'left4dead2', 'addonlist.txt')];
  const before = files.map(file => fs.readFileSync(file));
  favorites.add(item()); favorites.add(item('2')); favorites.remove('1');
  assert.deepEqual(favorites.list().map(value => value.id), ['2']);
  files.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
  assert.equal(library.scan().items[0].enabled, true);
});
test('invalid bookmark data is rejected and previews never preserve credentials or local paths', t => {
  const { favorites } = setup(t);
  for (const id of ['0', '../secret', 'steam://1', 1, '-1']) assert.throws(() => favorites.add(item(id)));
  assert.throws(() => favorites.add({ id: '1', title: '' }), /标题/);
  for (const image of ['file:///C:/secret', 'javascript:alert(1)', 'https://user:pass@example.com/']) assert.equal(snapshot({ ...item(), image }).image, '');
  assert.equal(snapshot({ ...item(), tags: ['Weapons', null, 'Weapons', {}] }).tags.length, 1);
  assert.deepEqual(favorites.list(), []);
});
test('failed persistence keeps the old in-memory bookmark and file, and deleting an absent ID is a no-op', t => {
  const { root, favorites } = setup(t); favorites.add(item());
  const before = fs.readFileSync(favorites.file), list = favorites.list();
  favorites.remove('999'); assert.deepEqual(fs.readFileSync(favorites.file), before);
  favorites.file = path.join(root, 'missing', 'favorites.json');
  assert.throws(() => favorites.remove('1')); assert.deepEqual(favorites.list(), list);
});
test('favorite filters retain exact survivor and firearm classification without relying on installed state', () => {
  const ak = item(), nick = { id: '2', title: 'Maid replaces Nick', tags: ['Survivors'] };
  const test = (value, ...filters) => matches(value, describe(value), ...filters);
  assert.ok(test(ak, 'weapon', 'rifle', 'weapon:ak47'));
  assert.ok(!test(ak, 'weapon', 'shotgun')); assert.ok(!test(ak, 'weapon', 'rifle', 'weapon:m16'));
  assert.ok(test(nick, 'survivor', 'nick', 'survivor:nick')); assert.ok(!test(nick, 'survivor', 'zoey'));
  assert.ok(test({ title: 'Generic', tags: ['Weapons', 'Rifle'] }, 'weapon', 'rifle'));
  assert.ok(!test({ title: 'Generic', tags: ['Weapons', 'Rifle'] }, 'weapon', 'rifle', 'weapon:ak47'));
  assert.ok(test({ title: 'Campaign', tags: ['Campaigns', 'Co-op'] }, 'campaignMap', 'coop'));
  assert.ok(test({ title: 'Unknown', tags: [] }, 'all')); assert.ok(!test({ title: 'Unknown', tags: [] }, 'weapon'));
});

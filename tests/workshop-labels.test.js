const test = require('node:test');
const assert = require('node:assert/strict');
const { describe } = require('../renderer/workshop-labels');
const { targets } = require('../renderer/catalog');
const ids = labels => labels.map(value => value.id);

test('workshop labels translate author tags and identify exact survivor slots', () => {
  const labels = describe({ title: 'Hatsune Miku', tags: ['Survivors', 'Nick', 'Models'] });
  assert.ok(labels.some(value => value.id === 'survivor:nick' && value.source === 'steam'));
  assert.ok(labels.some(value => value.label === '幸存者'));
  assert.ok(labels.some(value => value.label === '模型'));
  assert.equal(new Set(labels.map(value => value.label)).size, labels.length);
});

test('explicit replacement wins over advertised model and unrelated author tags', () => {
  for (const title of ['AK47 model replaces M16', 'AK47 模型（替换 M16）', 'Replaces M16 with AK47']) {
    const labels = describe({ title, tags: ['Weapons', 'Rifle', 'AK47'], description: 'Also for SCAR in a separate release.' });
    assert.ok(ids(labels).includes('weapon:m16'), title);
    assert.ok(!ids(labels).includes('weapon:ak47'), title);
    assert.ok(!ids(labels).includes('weapon:scar'), title);
    assert.equal(labels[0].source, 'replacement');
  }
});

test('description replacement accepts multiple slots but ignores credits', () => {
  const labels = describe({ title: 'Weapon pack', tags: ['Weapons'], description: 'Replaces UZI and MP5.\nCredits:\nModel for Nick.' });
  assert.ok(ids(labels).includes('weapon:uzi'));
  assert.ok(ids(labels).includes('weapon:mp5'));
  assert.ok(!ids(labels).includes('survivor:nick'));
});

test('generic weapon tags never invent a specific replacement slot', () => {
  for (const tag of ['Rifle', 'Shotgun', 'SMG', 'Pistol']) {
    const labels = describe({ title: 'Custom skin pack', tags: ['Weapons', tag] });
    assert.ok(!labels.some(value => value.targetId), tag);
    assert.ok(ids(labels).includes('slot:unknown'), tag);
  }
  assert.ok(!ids(describe({ title: 'AR15', tags: ['Weapons', 'Rifle'] })).includes('weapon:m16'));
});

test('title inferences are marked and scoped to the declared content type', () => {
  const labels = describe({ title: 'Nick anime skin (Military Sniper)', tags: ['Weapons', 'Sniper'] });
  assert.ok(labels.some(value => value.id === 'weapon:military' && value.source === 'title'));
  assert.ok(!ids(labels).includes('survivor:nick'));
  assert.ok(!describe({ title: 'Producer manager mechanic outfit', tags: ['Survivors'] }).some(value => value.targetId));
});

test('installed VPK classification overrides remote metadata', () => {
  const local = { ...targets.find(value => value.id === 'weapon:spas'), evidence: ['models/weapons/v_shotgun_spas.mdl'] };
  const labels = describe({ title: 'AK47 replaces M16', tags: ['Weapons', 'Rifle'] }, [local]);
  assert.ok(labels.some(value => value.id === 'weapon:spas' && value.source === 'local'));
  assert.ok(!ids(labels).includes('weapon:m16'));
  assert.ok(!ids(labels).includes('weapon:ak47'));
});

test('specific infected and unknown metadata stay explicit', () => {
  assert.ok(describe({ tags: [{ tag: 'Common Infected' }] }).some(value => value.label === '普通感染者'));
  assert.ok(describe({ tags: ['Special Infected', 'Tank'] }).some(value => value.id === 'infected:tank'));
  assert.deepEqual(ids(describe({})), ['category:unknown']);
});

test('card limits preserve specific slots, content type and subtype ahead of auxiliary tags', () => {
  const labels = describe({ title: 'AR15 replaces M16', tags: ['UI', 'Sounds', 'Models', 'Weapons', 'Textures', 'Rifle', 'Scripts'] });
  assert.deepEqual(ids(labels).slice(0, 3), ['weapon:m16', 'category:weapon', 'tag:rifle']);
  assert.equal(labels.filter(value => /材质/.test(value.label)).length, 1);
  const unknown = describe({ title: 'AR15', tags: ['UI', 'Sounds', 'Models', 'Textures', 'Weapons', 'Rifle', 'Scripts'] });
  assert.ok(ids(unknown).slice(0, 6).includes('slot:unknown'));
  assert.ok(!describe({ tags: ['Weapons', 'Rifle', 'Other'] }).some(value => value.label === '其他物品'));
  assert.ok(describe({ tags: ['Items', 'Other'] }).some(value => value.label === '其他物品'));
});

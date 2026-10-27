const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../core/classification');
const { targets } = require('../renderer/catalog');
const read = (paths, metadata) => classify(paths.map(path => ({ path })), metadata);

test('all eight survivor models and their weapon-folder arms resolve to the character slot', () => {
  for (const [name, body, arms] of [
    ['nick', 'gambler', 'gambler_new'], ['rochelle', 'producer', 'producer_new'], ['coach', 'coach', 'coach_new'], ['ellis', 'mechanic', 'mechanic_new'],
    ['bill', 'namvet', 'bill'], ['zoey', 'teenangst', 'zoey'], ['francis', 'biker', 'francis'], ['louis', 'manager', 'louis'],
  ]) {
    const result = read([`models/weapons/arms/v_arms_${arms}.mdl`, `models/survivors/survivor_${body}.mdl`], { addontype: 'Weapon', addoncontent_survivor: '1' });
    assert.equal(result.type, 'survivor', name);
    assert.deepEqual(result.targets.map(target => target.id), [`survivor:${name}`]);
    assert.equal(read([`models/weapons/arms/v_arms_${arms}.mdl`]).targets[0].id, `survivor:${name}`);
  }
});

test('actual firearm, melee and item slots are recognized in v_models and w_models before accompanying sounds', () => {
  const expected = [
    ['v_smg', 'weapon:uzi'], ['w_smg_uzi', 'weapon:uzi'], ['v_silenced_smg', 'weapon:silenced'], ['v_smg_mp5', 'weapon:mp5'],
    ['v_rifle', 'weapon:m16'], ['w_rifle_m16a2', 'weapon:m16'], ['v_rifle_ak47', 'weapon:ak47'], ['v_desert_rifle', 'weapon:scar'],
    ['v_rif_sg552', 'weapon:sg552'], ['v_pumpshotgun', 'weapon:pump'], ['v_shotgun_chrome', 'weapon:chrome'], ['v_autoshotgun', 'weapon:autoshotgun'],
    ['v_shotgun_spas', 'weapon:spas'], ['v_sniper_military', 'weapon:military'], ['v_huntingrifle', 'weapon:hunting'], ['v_snip_awp', 'weapon:awp'],
    ['v_snip_scout', 'weapon:scout'], ['v_m60', 'weapon:m60'], ['v_grenade_launcher', 'weapon:grenade'], ['v_desert_eagle', 'weapon:magnum'],
    ['v_pistola', 'weapon:pistol'], ['v_katana', 'weapon:katana'], ['v_fireaxe', 'weapon:axe'], ['v_chainsaw', 'weapon:chainsaw'],
    ['v_bile_flask', 'item:bile'], ['v_painpills_l4d2', 'item:pills'], ['w_eq_medkit', 'item:medkit'], ['v_defibrillator', 'item:defib'],
    ['v_pipebomb', 'item:pipebomb'], ['v_molotov', 'item:molotov'],
  ];
  for (const [model, slot] of expected) {
    const result = read([`models/${model.startsWith('w_') ? 'w_models/weapons' : 'v_models'}/${model}.mdl`, 'sound/misc/support.wav'], { addontype: 'Sound', addoncontent_sound: '1' });
    assert.equal(result.targets[0].id, slot, model);
    assert.equal(result.type, slot.split(':')[0], model);
  }
});

test('a multi-target package retains every actual replacement and does not use its marketing title', () => {
  const result = read(['models/survivors/survivor_gambler.mdl', 'models/survivors/survivor_mechanic.mdl', 'models/v_models/v_rifle.mdl'], { addontitle: 'a misleading AK47 Rochelle title' });
  assert.deepEqual(result.categories, ['survivor', 'weapon']);
  assert.deepEqual(result.targets.map(target => target.id).sort(), ['survivor:ellis', 'survivor:nick', 'weapon:m16']);
});

test('campaign bundles do not become survivor or weapon replacements from their bundled assets', () => {
  const result = read(['maps/custom.bsp', 'models/survivors/survivor_gambler.mdl', 'models/v_models/v_rifle.mdl', 'sound/music/test.wav']);
  assert.deepEqual(result.categories, ['map']); assert.deepEqual(result.targets.map(target => target.id), ['map:campaign']);
  assert.equal(read(['materials/custom_map/test.vmt'], { addoncontent_campaign: '1' }).targets[0].id, 'map:resources');
});

test('material, portrait, voice and weapon-script-only packs retain their specific target', () => {
  for (const [resource, id] of [
    ['materials/models/survivors/gambler/nick.vmt', 'survivor:nick'], ['materials/vgui/s_panel_gambler.vtf', 'survivor:nick'],
    ['sound/player/survivor/voice/producer/hello.wav', 'survivor:rochelle'], ['materials/models/v_models/v_rifle_ak47/skin.vmt', 'weapon:ak47'],
    ['scripts/weapon_rifle_ak47.txt', 'weapon:ak47'], ['scripts/melee/katana.txt', 'weapon:katana'], ['sound/weapons/ak47/fire.wav', 'weapon:ak47'],
  ]) assert.equal(read([resource]).targets[0].id, id, resource);
});

test('unknown content stays explicitly unclassified and zero-valued author flags do not create categories', () => {
  assert.equal(read(['models/custom/a.mdl'], { addoncontent_survivor: '0', addoncontent_weapon: '0' }).targets[0].id, 'mod:unknown');
  assert.equal(read(['models/weapons/arms/custom.mdl']).targets[0].id, 'survivor:unknown');
  assert.equal(read(['models/v_models/v_custom.mdl']).targets[0].id, 'weapon:unknown');
  assert.equal(read(['models/custom/a.mdl'], { addoncontent_survivor: 'Francis' }).targets[0].id, 'survivor:francis');
  assert.equal(read(['models/infected/hulk.mdl']).targets[0].id, 'infected:tank');
  assert.equal(read(['models/infected/common_male01.mdl']).targets[0].id, 'infected:common');
  assert.equal(read(['sound/music/a.wav']).targets[0].id, 'sound:music');
  assert.equal(read(['scripts/vscripts/main.nut']).type, 'script');
  assert.equal(new Set(targets.map(target => target.id)).size, targets.length);
});

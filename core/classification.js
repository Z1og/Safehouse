const { targets: catalog } = require('../renderer/catalog');

const byId = new Map(catalog.map(target => [target.id, target]));
const weaponStems = new Map(catalog.filter(target => ['weapon', 'item'].includes(target.type)).flatMap(target => target.stems.map(stem => [stem, target.id])));
const people = catalog.filter(target => target.type === 'survivor' && target.stems.length);
const infected = catalog.filter(target => target.type === 'infected' && target.stems.length);
const names = new Map([...people, ...infected].map(target => [target.id, target.stems.map(stem => new RegExp(`(?:^|[/_])${stem}(?:$|[/_.])`))]));
const on = value => value != null && !['', '0', 'false', 'no'].includes(String(value).trim().toLowerCase());
const token = value => value.replace(/^(?:anim_)?[vw]_/, '').replace(/_l4d[12]$/, '');

function classify(entries, metadata = {}) {
  const paths = entries.map(entry => entry.path), found = new Map();
  function add(id, path = '', via = 'resource') {
    const definition = byId.get(id); if (!definition) return;
    if (!found.has(id)) found.set(id, { id, type: definition.type, group: definition.group, label: definition.label, evidence: [], via });
    const target = found.get(id);
    if (path && target.evidence.length < 3 && !target.evidence.includes(path)) target.evidence.push(path);
  }
  const flag = (...names) => names.some(name => on(metadata[`addoncontent_${name}`]));
  const mapFile = paths.find(p => /^maps\/.*\.bsp$|^missions\/.*\.txt$/.test(p));
  // Maps ship their own models, weapons and sounds. These are bundled map
  // resources, not standalone replacements for every slot mentioned inside.
  if (mapFile) add('map:campaign', mapFile);
  else {
    for (const p of paths) {
      const body = p.match(/^models\/survivors\/(?:survivor_|anim_)?([^/.]+)(?:\.[^/]*)?$/);
      const arms = p.match(/^models\/(?:weapons\/arms\/|v_models\/(?:arms\/)?)(?:v_)?arms_([^/.]+)\./);
      const portrait = p.match(/^(?:materials\/vgui\/|materials\/models\/survivors\/|sound\/player\/survivor\/voice\/)(.*)$/);
      for (const person of people) {
        const named = value => names.get(person.id).some(pattern => pattern.test(value));
        if (body && named(body[1]) || arms && named(arms[1]) || portrait && named(portrait[1])) add(person.id, p);
      }
      const weaponModel = p.match(/^models\/(?:v_models|w_models|weapons)\/(?!arms\/)(?:.*\/)?([^/]+)\.mdl$/);
      const weaponScript = p.match(/^scripts\/(?:melee\/)?(?:weapon_)?([^/]+)\.txt$/);
      const weaponSound = p.match(/^sound\/weapons\/([^/]+)\//);
      const material = p.match(/^materials\/models\/(?:v_models|w_models|weapons)\/(?!arms\/)(.+)$/);
      for (const name of [weaponModel?.[1], weaponScript?.[1], weaponSound?.[1], ...(material ? material[1].split('/').slice(0, -1) : [])].filter(Boolean)) {
        const id = weaponStems.get(token(name)); if (id) add(id, p);
      }
      if (/^(?:models|materials\/models)\/infected\//.test(p) || /^models\/v_models\/weapons\/v_claw_/.test(p)) {
        for (const target of infected) if (names.get(target.id).some(pattern => pattern.test(p))) add(target.id, p);
        if (/\/infected\/common_/.test(p)) add('infected:common', p);
      }
    }
    // Generic structural evidence and explicit author flags are fallbacks.
    // Never treat first-person character arms as a weapon replacement.
    if (!found.size) {
      if (flag('campaign', 'map')) add('map:resources', '', 'metadata');
      else if (paths.some(p => /^(?:models|materials\/models)\/survivors\/|^models\/weapons\/arms\//.test(p)) || flag('survivor')) {
        const declared = String(metadata.addoncontent_survivor || '').toLowerCase();
        const person = people.find(person => [...person.stems, ...person.aliases].some(name => declared === name));
        const resource = paths.find(p => /\/survivors\/|\/weapons\/arms\//.test(p));
        add(person?.id || 'survivor:unknown', resource, resource ? 'resource' : 'metadata');
      } else if (paths.some(p => /^(?:models|materials\/models)\/infected\//.test(p)) || flag('bossinfected', 'commoninfected')) add(flag('commoninfected') ? 'infected:common' : 'infected:unknown', paths.find(p => /\/infected\//.test(p)), 'metadata');
      else if (paths.some(p => /^models\/(?:v_models|w_models|weapons)\/(?!arms\/).*\.mdl$/.test(p) && !/\/arms\/|\/v_arms_/.test(p)) || flag('weapon', 'weaponmodel')) add('weapon:unknown', paths.find(p => /^models\/(?:v_models|w_models|weapons)\//.test(p) && !/\/arms\/|\/v_arms_/.test(p)), 'metadata');
    }
    if (!found.size) {
      const declared = String(metadata.addontype || metadata.addon_type || metadata.type || metadata.category || '').toLowerCase();
      const declaredId = /campaign|map|level|地图|战役/.test(declared) ? 'map:resources' : /weapon|gun|武器/.test(declared) ? 'weapon:unknown' : /survivor|character|player|角色|幸存者/.test(declared) ? 'survivor:unknown' : /sound|audio|music|音效|声音/.test(declared) ? 'sound:effects' : '';
      if (declaredId) add(declaredId, '', 'metadata');
      else if (paths.some(p => /^sound\/music\//.test(p)) || flag('music')) add('sound:music', paths.find(p => /^sound\/music\//.test(p)));
      else if (paths.some(p => /^sound\/player\/survivor\/voice\//.test(p))) add('sound:voice', paths.find(p => /^sound\/player\/survivor\/voice\//.test(p)));
      else if (paths.some(p => /^sound\//.test(p)) || flag('sound')) add('sound:effects', paths.find(p => /^sound\//.test(p)));
      else if (paths.some(p => /^materials\/vgui\/logos\//.test(p)) || flag('spray')) add('ui:spray', paths.find(p => /^materials\/vgui\/logos\//.test(p)));
      else if (paths.some(p => /^(?:media|materials\/console)\//.test(p)) || flag('backgroundmovie')) add('ui:background', paths.find(p => /^(?:media|materials\/console)\//.test(p)));
      else if (paths.some(p => /^(?:resource|materials\/vgui|scripts\/hudlayout)/.test(p))) add('ui:hud', paths.find(p => /^(?:resource|materials\/vgui|scripts\/hudlayout)/.test(p)));
      else if (paths.some(p => /^scripts\//.test(p)) || flag('script')) add('script:gameplay', paths.find(p => /^scripts\//.test(p)));
      else if (paths.some(p => /^materials\//.test(p))) add('mod:textures', paths.find(p => /^materials\//.test(p)));
      else add('mod:unknown', '', 'unknown');
    }
  }
  const targets = [...found.values()];
  const order = ['map', 'survivor', 'weapon', 'infected', 'item', 'sound', 'ui', 'script', 'mod'];
  const categories = order.filter(type => targets.some(target => target.type === type));
  return { type: categories[0] || 'mod', categories, targets, classificationSource: targets.some(target => target.evidence.length) ? 'resource' : targets.some(target => target.via === 'metadata') ? 'metadata' : 'unknown' };
}
module.exports = { classify };

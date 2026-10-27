(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog'), require('./workshop-catalog'));
  else root.SafehouseWorkshopLabels = factory(root.SafehouseCatalog, root.SafehouseWorkshopCatalog);
})(typeof globalThis === 'object' ? globalThis : this, function (catalog, workshop) {
  const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = {
    'weapon:pistol': ['pistol', 'dual pistols', '双持手枪'], 'weapon:magnum': ['magnum', 'desert eagle', 'pistol_magnum', '沙鹰', '沙漠之鹰'],
    'weapon:uzi': ['uzi', 'smg_uzi'], 'weapon:silenced': ['silenced smg', 'smg_silenced', 'MAC-10', '消音冲锋枪'], 'weapon:mp5': ['MP5'],
    'weapon:pump': ['pump shotgun', 'pumpshotgun', '木喷'], 'weapon:chrome': ['chrome shotgun', 'shotgun_chrome', '铁喷'],
    'weapon:autoshotgun': ['autoshotgun', 'auto shotgun', 'M1014', '战术连喷'], 'weapon:spas': ['SPAS', 'SPAS-12', 'shotgun_spas'],
    'weapon:m16': ['M16', 'M16A2', 'rifle_m16a2'], 'weapon:ak47': ['AK47', 'AK-47', 'AK 47'],
    'weapon:scar': ['SCAR', 'SCAR-L', 'SCAR-H', 'rifle_desert', '三连发'], 'weapon:sg552': ['SG552', 'SG-552'],
    'weapon:hunting': ['hunting rifle', 'huntingrifle', 'Mini-14', '猎狙'], 'weapon:military': ['military sniper', 'sniper_military', '军用狙击枪', '军狙'],
    'weapon:awp': ['AWP'], 'weapon:scout': ['Scout'], 'weapon:m60': ['M60'], 'weapon:grenade': ['grenade launcher', '榴弹发射器'],
    'weapon:minigun': ['minigun', '固定机枪'],
  };
  const definitions = catalog.targets.filter(target => !target.id.endsWith(':unknown') && ['survivor', 'weapon', 'infected', 'item'].includes(target.type)).map(target => {
    const names = exact[target.id] || [...target.label.split(/\s+[·/]\s+/), ...target.aliases, ...(target.type === 'survivor' ? [] : target.stems.filter(stem => !['survivor', 'common'].includes(stem)))];
    return { ...target, names: [...new Set(names)].sort((a, b) => b.length - a.length) };
  });
  function found(text) {
    return definitions.filter(target => target.names.some(name => new RegExp(/[\u3400-\u9fff]/u.test(name) ? escape(name) : `(?<![a-z0-9])${escape(name).replace(/[ _-]+/g, '[ _-]*')}(?![a-z0-9])`, 'i').test(text)));
  }
  function replacements(text) {
    const matches = [...String(text).matchAll(/(?:替换|取代|替代|\breplac(?:e[sd]?|ing|ement)(?:\s+for)?\b|\bfor\b)\s*[:：-]?\s*([^\n.;!。；|]{1,110})/gi)];
    return matches.flatMap(match => found(match[1].split(/\b(?:with|by|credits|features|includes)\b/i)[0]));
  }
  const categoryMap = new Map(), childMap = new Map();
  for (const [category, value] of Object.entries(workshop.categories)) {
    for (const tag of value.tags) if (!categoryMap.has(key(tag))) categoryMap.set(key(tag), { category, label: value.label });
    for (const [subcategory, label, tag] of value.children) if (!childMap.has(key(tag))) childMap.set(key(tag), { category, subcategory, label });
  }
  const sourceNames = { local: '本地 VPK 实际资源', steam: '作者填写的 Steam 工坊标签', replacement: '作者标题 / 描述中的替换说明', title: '标题关键词推断，尚未下载核验', unknown: '作者未提供足够信息，安装后可按 VPK 实际资源确认' };
  function describe(item, localTargets = []) {
    const labels = new Map(), slots = new Map(), categoryTypes = new Set();
    const add = (id, label, source, evidence = '', extra = {}) => { if (!labels.has(id)) labels.set(id, { id, label, source, evidence, sourceLabel: sourceNames[source], ...extra }); };
    const target = (definition, source, evidence) => {
      if (!slots.has(definition.id)) slots.set(definition.id, { ...definition, source, evidence });
      categoryTypes.add(definition.type);
    };
    const title = String(item.title || '').slice(0, 2000), description = String(item.description || '').slice(0, 16000).replace(/<[^>]*>|\[\/?[^\]]*\]/g, ' ');
    const declared = [...new Set((Array.isArray(item.tags) ? item.tags : []).map(tag => typeof tag === 'string' ? tag : tag?.tag || '').filter(Boolean))];
    for (const tag of declared) {
      const parent = categoryMap.get(key(tag)), child = childMap.get(key(tag));
      if (parent) {
        const type = parent.category === 'campaignMap' ? 'map' : parent.category;
        categoryTypes.add(type); add(`category:${type}`, parent.label, 'steam', tag);
      }
      if (child && child.label !== parent?.label && (child.category !== 'all' || !parent)) add(`tag:${key(tag)}`, key(tag) === 'other' && !declared.some(value => key(value) === 'items') ? '其他内容' : child.label, 'steam', tag);
    }
    const local = localTargets.filter(value => !value.id.endsWith(':unknown'));
    if (local.length) for (const value of local) target(value, 'local', value.evidence?.[0] || value.label);
    else {
      const explicitTitle = replacements(title), explicitDescription = replacements(description.split(/(?:^|\n)\s*(?:credits|致谢|鸣谢)\s*[:：]?/i)[0]);
      const explicit = [...explicitTitle, ...explicitDescription.filter(value => !explicitTitle.some(other => other.type === value.type))];
      for (const value of explicit) target(value, 'replacement', explicitTitle.includes(value) ? title : description.slice(0, 350));
      for (const tag of declared) for (const value of definitions.filter(target => target.names.some(name => key(name) === key(tag)))) if (!['pistol', 'smg', 'shotgun', 'rifle', 'sniper'].includes(key(tag)) && !explicit.some(other => other.type === value.type)) target(value, 'steam', tag);
      const scopedTypes = [...categoryTypes].filter(type => ['survivor', 'weapon', 'infected', 'item'].includes(type));
      for (const value of found(title)) if ((!scopedTypes.length || scopedTypes.includes(value.type)) && ![...slots.values()].some(other => other.type === value.type && other.source !== 'title')) target(value, 'title', title);
    }
    // Specific replacement slots come first, matching the local library cards.
    const specifics = [...slots.values()].map(value => ({ id: value.id, label: value.label, source: value.source, sourceLabel: sourceNames[value.source], evidence: value.evidence, targetId: value.id }));
    for (const type of categoryTypes) if (catalog.types[type]) add(`category:${type}`, catalog.types[type], slots.size ? specifics[0].source : 'steam');
    const all = [...specifics, ...labels.values()].filter((value, index, values) => values.findIndex(other => key(other.label) === key(value.label)) === index);
    if (!specifics.length && [...categoryTypes].some(type => ['weapon', 'survivor', 'infected', 'item'].includes(type))) all.push({ id: 'slot:unknown', label: '具体槽位未注明', source: 'unknown', sourceLabel: sourceNames.unknown, evidence: '' });
    if (!all.length) all.push({ id: 'category:unknown', label: '分类未注明', source: 'unknown', sourceLabel: sourceNames.unknown, evidence: '' });
    const mainTypes = ['weapon', 'survivor', 'infected', 'item', 'map', 'campaignMap', 'campaign'];
    const priority = value => value.targetId ? 0 : mainTypes.includes(value.id.split(':')[1]) && value.id.startsWith('category:') ? 1 : value.id.startsWith('tag:') && mainTypes.includes(childMap.get(value.id.slice(4))?.category) ? 2 : value.id === 'slot:unknown' ? 3 : value.id.startsWith('category:') ? 4 : 5;
    return all.sort((a, b) => priority(a) - priority(b));
  }
  return { describe };
});

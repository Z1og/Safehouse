(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog'), require('./workshop-catalog'));
  else root.SafehouseFavoriteFilters = factory(root.SafehouseCatalog, root.SafehouseWorkshopCatalog);
})(typeof globalThis === 'object' ? globalThis : this, function (catalog, workshop) {
  const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function matches(item, labels, category = 'all', subcategory = 'all', target = 'all') {
    const tags = new Set((item.tags || []).map(key));
    const targets = labels.filter(label => label.targetId).map(label => catalog.targets.find(value => value.id === label.targetId)).filter(Boolean);
    const type = category === 'campaignMap' ? 'map' : category;
    const declared = workshop.categories[category];
    if (!declared) return false;
    const categoryMatch = category === 'all' || labels.some(label => label.id === `category:${type}`) || targets.some(value => value.type === type)
      || declared.tags.length && (declared.matchAnyTag ? declared.tags.some(tag => tags.has(key(tag))) : declared.tags.every(tag => tags.has(key(tag))));
    if (!categoryMatch || target !== 'all' && !targets.some(value => value.id === target)) return false;
    if (subcategory === 'all') return true;
    const child = declared.children.find(value => value[0] === subcategory);
    if (!child) return false;
    return tags.has(key(child[2])) || labels.some(label => label.id === `tag:${key(child[2])}`)
      || targets.some(value => (category === 'all' || value.type === type) && (value.group === subcategory || value.id === `${type}:${subcategory}` || category === 'weapon' && subcategory === 'grenadeLauncher' && value.id === 'weapon:grenade'));
  }
  return { matches };
});

/* Steam L4D2 ready-to-use tags, shared by public browsing and Steamworks. */
(function (root) {
  const modeTags = [['single', '单人', 'Single Player'], ['coop', '合作', 'Co-op'], ['versus', '对抗', 'Versus'], ['scavenge', '清道夫', 'Scavenge'], ['survival', '生存', 'Survival'], ['realism', '写实', 'Realism'], ['realismVersus', '写实对抗', 'Realism Versus'], ['mutations', '突变', 'Mutations']];
  const contentTags = [['models', '模型', 'Models'], ['textures', '材质', 'Textures'], ['sounds', '音效', 'Sounds'], ['scripts', '脚本', 'Scripts'], ['ui', '界面', 'UI']];
  const categories = {
    all: { label: '全部内容', tags: [], children: contentTags },
    campaignMap: { label: '战役地图', tags: ['Campaigns'], children: modeTags },
    campaign: { label: '战役', tags: ['Campaigns'], children: modeTags },
    survivor: { label: '幸存者', tags: ['Survivors'], children: [['nick', 'Nick · 尼克', 'Nick'], ['rochelle', 'Rochelle · 罗雪儿', 'Rochelle'], ['coach', 'Coach · 教练', 'Coach'], ['ellis', 'Ellis · 埃利斯', 'Ellis'], ['bill', 'Bill · 比尔', 'Bill'], ['zoey', 'Zoey · 佐伊', 'Zoey'], ['francis', 'Francis · 弗朗西斯', 'Francis'], ['louis', 'Louis · 路易斯', 'Louis']] },
    weapon: { label: '武器', tags: ['Weapons'], children: [['pistol', '手枪', 'Pistol'], ['smg', '冲锋枪', 'SMG'], ['shotgun', '霰弹枪', 'Shotgun'], ['rifle', '步枪', 'Rifle'], ['sniper', '狙击枪', 'Sniper'], ['m60', 'M60 机枪', 'M60'], ['grenadeLauncher', '榴弹发射器', 'Grenade Launcher'], ['melee', '近战', 'Melee'], ['throwable', '投掷物', 'Throwable']] },
    infected: { label: '感染者', tags: ['Common Infected', 'Special Infected'], matchAnyTag: true, children: [['common', '普通感染者', 'Common Infected'], ['special', '特殊感染者', 'Special Infected'], ...[["Boomer", "胖子"], ["Charger", "牛"], ["Hunter", "猎人"], ["Jockey", "猴子"], ["Smoker", "舌头"], ["Spitter", "口水"], ["Tank", "坦克"], ["Witch", "女巫"]].map(([name, label]) => [name.toLowerCase(), `${name} · ${label}`, name])] },
    item: { label: '物品', tags: ['Items'], children: [['medkit', '医疗包', 'Medkit'], ['pills', '止痛药', 'Pills'], ['adrenaline', '肾上腺素', 'Adrenaline'], ['defibrillator', '电击器', 'Defibrillator'], ['other', '其他物品', 'Other']] },
    skin: { label: '皮肤 / 材质', tags: ['Textures'], children: [['survivor', '幸存者', 'Survivors'], ['weapon', '武器', 'Weapons'], ['infected', '特殊感染者', 'Special Infected'], ['item', '物品', 'Items']] },
    sound: { label: '音效', tags: ['Sounds'], children: [['survivor', '幸存者', 'Survivors'], ['weapon', '武器', 'Weapons'], ['infected', '特殊感染者', 'Special Infected'], ['item', '物品', 'Items']] },
    ui: { label: '界面', tags: ['UI'], children: modeTags },
    script: { label: '插件 / 脚本', tags: ['Scripts'], children: modeTags },
    other: { label: '其他', tags: ['Miscellaneous'], children: contentTags },
  };
  function resolveFilter(category = 'all', subcategory = 'all') {
    if (typeof category !== 'string' || !Object.hasOwn(categories, category)) throw new Error('工坊分类无效');
    const value = categories[category];
    if (subcategory === 'all') return { tags: [...value.tags], matchAnyTag: Boolean(value.matchAnyTag) };
    const child = value.children.find(entry => entry[0] === subcategory);
    if (!child) throw new Error('工坊细分类无效');
    return { tags: [...new Set([...(value.matchAnyTag ? [] : value.tags), child[2]])], matchAnyTag: false };
  }
  const catalog = { categories, resolveFilter };
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.SafehouseWorkshopCatalog = catalog;
})(typeof window === 'object' ? window : globalThis);

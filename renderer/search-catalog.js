(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafehouseSearch = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  // Canonical names keep compound queries together instead of broad OR matches.
  const entries = [
    ['Nick', '尼克', '赌徒'], ['Rochelle', '罗谢尔', '洛希尔', '黑妹'], ['Coach', '教练'], ['Ellis', '艾利斯', '埃利斯'],
    ['Bill', '比尔', '老兵'], ['Zoey', '佐伊', '若伊'], ['Francis', '弗朗西斯'], ['Louis', '路易斯'],
    ['Hatsune Miku', '初音未来', '初音', 'Miku'], ['Touhou', '东方project', '东方'], ['anime', '二次元', '动漫'],
    ['maid', '女仆'], ['tactical', '战术'], ['realistic', '写实'], ['sound', '音效'], ['music', '音乐'], ['voice', '语音'],
    ['survivor', '幸存者', '生还者'], ['weapon', '武器'], ['skin', '皮肤'], ['animation', '动作', '动画'],
    ['The Last Stand', '最后一搏'], ['Dead Center', '死亡中心'], ['Dark Carnival', '黑色狂欢节'], ['Swamp Fever', '沼泽激战'],
    ['Hard Rain', '暴风骤雨'], ['The Parish', '教区'], ['The Passing', '短暂时刻'], ['The Sacrifice', '牺牲'],
    ['No Mercy', '毫不留情'], ['Crash Course', '坠机险途'], ['Death Toll', '死亡丧钟'], ['Dead Air', '静寂时分'],
    ['Blood Harvest', '血腥收获'], ['Cold Stream', '刺骨寒溪'], ['campaign', '战役'], ['map', '地图'],
    ['silenced SMG', '消音冲锋枪', '消音微冲'], ['chrome shotgun', '铁喷', '铬合金霰弹枪'], ['pump shotgun', '木喷', '泵动霰弹枪'],
    ['combat shotgun', '战斗霰弹枪', 'SPAS'], ['auto shotgun', '自动霰弹枪', '连喷'], ['hunting rifle', '猎枪', '猎狙'],
    ['military sniper', '军用狙击枪', '军狙'], ['sniper rifle', '狙击步枪', '狙击枪'], ['assault rifle', '突击步枪'],
    ['SMG', '冲锋枪'], ['shotgun', '霰弹枪', '散弹枪'], ['pistol', '手枪'], ['magnum', '马格南', '沙鹰', 'Desert Eagle'],
    ['AK47', 'AK-47', '卡拉什尼科夫'], ['M16', 'M16A2'], ['SCAR', '三连发'], ['grenade launcher', '榴弹发射器', '榴弹枪'],
    ['chainsaw', '电锯'], ['katana', '武士刀'], ['machete', '砍刀'], ['fire axe', '消防斧'], ['crowbar', '撬棍'],
    ['baseball bat', '棒球棍'], ['frying pan', '平底锅'], ['melee', '近战'],
    ['first aid kit', '急救包', '医疗包', 'medkit'], ['pain pills', '止痛药', '药丸', 'pills'], ['adrenaline', '肾上腺素'],
    ['defibrillator', '除颤器', '电击器'], ['molotov', '燃烧瓶'], ['pipe bomb', '土制炸弹', '管状炸弹'], ['bile bomb', '胆汁瓶', '胆汁炸弹'],
    ['infected', '感染者'], ['common infected', '普通感染者', '小僵尸'], ['Tank', '坦克'], ['Witch', '女巫'],
    ['Smoker', '烟鬼', '舌头'], ['Boomer', '胖子', '呕吐者'], ['Hunter', '猎人'], ['Charger', '牛哥', '冲锋者'],
    ['Spitter', '口水', '喷吐者'], ['Jockey', '猴子', '骑师'], ['crosshair', '准星'], ['HUD', '界面', '抬头显示'],
  ];
  const patterns = entries.flatMap(([canonical, ...aliases]) => [canonical, ...aliases].map(alias => ({ alias, canonical })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const lookup = new Map(patterns.map(entry => [entry.alias.toLowerCase(), entry.canonical.toLowerCase()]));
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(patterns.map(({ alias }) => /[\u3400-\u9fff]/u.test(alias) ? escaped(alias) : `(?<![a-z0-9])${escaped(alias)}(?![a-z0-9])`).join('|'), 'gi');
  const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(pattern, match => ` ${lookup.get(match.toLowerCase())} `).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const direct = query => /^\d{1,20}$|^https:\/\//i.test(query.trim());
  function aliases(query) {
    const original = String(query || '').trim();
    if (!original || direct(original)) return original ? [original] : [];
    const expanded = normalize(original);
    return [...new Map([original, expanded].filter(Boolean).map(value => [value.toLowerCase(), value])).values()];
  }
  function matches(text, queries) {
    const haystack = normalize(text);
    return !queries.length || queries.some(query => {
      const words = normalize(query).split(' ').filter(Boolean);
      return words.length && words.every(word => haystack.includes(word));
    });
  }
  return { aliases, normalize, matches, direct };
});

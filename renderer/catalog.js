/* Shared, static taxonomy for the VPK reader and the isolated renderer. */
(function (root) {
  const types = { map: '战役地图', survivor: '幸存者', weapon: '武器', infected: '感染者', item: '物品 / 投掷物', sound: '音效 / 音乐', ui: '界面', script: '脚本', mod: '其他模组' };
  const groups = {
    map: { campaign: '战役 / 地图', resources: '地图资源包' },
    survivor: { l4d2: '二代角色', l4d1: '一代角色', other: '未识别角色' },
    weapon: { pistol: '手枪', smg: '冲锋枪', shotgun: '霰弹枪', rifle: '突击步枪', sniper: '狙击枪', heavy: '重型武器', melee: '近战', other: '未细分武器' },
    infected: { special: '特殊感染者', common: '普通感染者', other: '未细分感染者' },
    item: { throwable: '投掷物', healing: '医疗 / 补给', carry: '携带物', other: '未细分物品' },
    sound: { music: '音乐', voice: '角色语音', effects: '环境 / 其他音效' },
    ui: { hud: 'HUD / 界面', spray: '喷漆', background: '背景 / 菜单' },
    script: { gameplay: '游戏脚本' }, mod: { textures: '材质 / 贴图', other: '未识别内容' },
  };
  const targets = [];
  function add(type, group, id, label, stems = [], aliases = []) { targets.push({ id: `${type}:${id}`, type, group, label, stems, aliases }); }
  add('survivor', 'l4d2', 'nick', 'Nick · 尼克', ['gambler', 'nick'], ['尼克']);
  add('survivor', 'l4d2', 'rochelle', 'Rochelle · 罗雪儿', ['producer', 'rochelle'], ['罗雪儿', '罗谢尔']);
  add('survivor', 'l4d2', 'coach', 'Coach · 教练', ['coach'], ['教练']);
  add('survivor', 'l4d2', 'ellis', 'Ellis · 埃利斯', ['mechanic', 'ellis'], ['埃利斯']);
  add('survivor', 'l4d1', 'bill', 'Bill · 比尔', ['namvet', 'bill'], ['比尔']);
  add('survivor', 'l4d1', 'zoey', 'Zoey · 佐伊', ['teenangst', 'zoey'], ['佐伊']);
  add('survivor', 'l4d1', 'francis', 'Francis · 弗朗西斯', ['biker', 'francis'], ['弗朗西斯']);
  add('survivor', 'l4d1', 'louis', 'Louis · 路易斯', ['manager', 'louis'], ['路易斯']);
  add('weapon', 'pistol', 'pistol', '手枪 / 双持手枪', ['pistol', 'pistola', 'dual_pistola', 'dualpistols', 'pistol_a', 'pistol_a_dual', 'pistol_b']);
  add('weapon', 'pistol', 'magnum', '马格南 / 沙漠之鹰', ['desert_eagle', 'pistol_magnum']);
  add('weapon', 'smg', 'uzi', 'UZI 冲锋枪', ['smg', 'smg_uzi', 'uzi']);
  add('weapon', 'smg', 'silenced', '消音冲锋枪 / MAC-10', ['silenced_smg', 'smg_silenced', 'smg_a']);
  add('weapon', 'smg', 'mp5', 'MP5 冲锋枪', ['smg_mp5', 'mp5']);
  add('weapon', 'shotgun', 'pump', '木质泵动霰弹枪', ['pumpshotgun', 'shotgun']);
  add('weapon', 'shotgun', 'chrome', '铁质 / Chrome 霰弹枪', ['shotgun_chrome', 'pumpshotgun_a']);
  add('weapon', 'shotgun', 'autoshotgun', '战术连喷 / M1014', ['autoshotgun', 'autoshot_m4super']);
  add('weapon', 'shotgun', 'spas', 'SPAS-12 战斗霰弹枪', ['shotgun_spas', 'spas']);
  add('weapon', 'rifle', 'm16', 'M16 突击步枪', ['rifle', 'rifle_m16a2', 'm16a2']);
  add('weapon', 'rifle', 'ak47', 'AK-47', ['rifle_ak47', 'ak47']);
  add('weapon', 'rifle', 'scar', 'SCAR 三连发步枪', ['desert_rifle', 'rifle_desert']);
  add('weapon', 'rifle', 'sg552', 'SG552', ['rif_sg552', 'rifle_sg552', 'sg552']);
  add('weapon', 'sniper', 'hunting', '猎枪 / Mini-14', ['huntingrifle', 'hunting_rifle', 'sniper_mini14']);
  add('weapon', 'sniper', 'military', '军用狙击枪', ['sniper_military']);
  add('weapon', 'sniper', 'awp', 'AWP', ['snip_awp', 'sniper_awp']);
  add('weapon', 'sniper', 'scout', 'Scout', ['snip_scout', 'sniper_scout']);
  add('weapon', 'heavy', 'm60', 'M60 机枪', ['m60', 'rifle_m60']);
  add('weapon', 'heavy', 'grenade', '榴弹发射器', ['grenade_launcher']);
  add('weapon', 'heavy', 'minigun', '固定机枪', ['minigun', '50cal', '50_cal']);
  for (const [id, label, stems] of [
    ['axe', '消防斧', ['fireaxe']], ['bat', '棒球棍', ['baseball_bat']], ['cricket', '板球拍', ['cricket_bat']],
    ['crowbar', '撬棍', ['crowbar']], ['pan', '平底锅', ['frying_pan']], ['guitar', '电吉他', ['electric_guitar']],
    ['katana', '武士刀', ['katana']], ['machete', '砍刀', ['machete']], ['tonfa', '警棍', ['tonfa']],
    ['golf', '高尔夫球杆', ['golfclub']], ['knife', '小刀', ['knife_t', 'knife']], ['chainsaw', '电锯', ['chainsaw']],
    ['pitchfork', '草叉', ['pitchfork']], ['shovel', '铲子', ['shovel']],
  ]) add('weapon', 'melee', id, label, stems);
  add('item', 'throwable', 'molotov', '燃烧瓶', ['molotov', 'eq_molotov']);
  add('item', 'throwable', 'pipebomb', '土制炸弹', ['pipebomb', 'eq_pipebomb']);
  add('item', 'throwable', 'bile', '胆汁罐', ['bile_flask', 'vomitjar', 'eq_bile_flask']);
  add('item', 'healing', 'medkit', '急救包', ['medkit', 'firstaidkit', 'first_aid_kit', 'eq_medkit']);
  add('item', 'healing', 'pills', '止痛药', ['painpills', 'eq_painpills']);
  add('item', 'healing', 'adrenaline', '肾上腺素', ['adrenaline', 'eq_adrenaline']);
  add('item', 'healing', 'defib', '电击器', ['defibrillator', 'eq_defibrillator', 'eq_defibrillator_no_paddles', 'eq_defibrillator_paddles']);
  add('item', 'healing', 'incendiary', '燃烧弹药包', ['incendiary_ammopack', 'eq_incendiary_ammopack', 'upgradepack_incendiary']);
  add('item', 'healing', 'explosive', '高爆弹药包', ['explosive_ammopack', 'eq_explosive_ammopack', 'upgradepack_explosive']);
  add('item', 'healing', 'laser', '激光瞄准器', ['laser_sights']);
  add('item', 'carry', 'cola', '可乐', ['cola']);
  for (const [id, label, stems] of [
    ['smoker', 'Smoker · 舌头', ['smoker']], ['boomer', 'Boomer · 胖子', ['boomer', 'boomette']],
    ['hunter', 'Hunter · 猎人', ['hunter']], ['spitter', 'Spitter · 口水', ['spitter']],
    ['jockey', 'Jockey · 猴子', ['jockey']], ['charger', 'Charger · 牛', ['charger']],
    ['tank', 'Tank · 坦克', ['hulk', 'tank']], ['witch', 'Witch · 女巫', ['witch', 'witch_bride']],
  ]) add('infected', 'special', id, label, stems);
  add('infected', 'common', 'common', '普通感染者', ['common_infected']);
  add('map', 'campaign', 'campaign', '战役 / 地图'); add('map', 'resources', 'resources', '地图资源包');
  add('sound', 'music', 'music', '音乐'); add('sound', 'voice', 'voice', '角色语音'); add('sound', 'effects', 'effects', '环境 / 其他音效');
  add('ui', 'hud', 'hud', 'HUD / 界面'); add('ui', 'spray', 'spray', '喷漆'); add('ui', 'background', 'background', '背景 / 菜单');
  add('script', 'gameplay', 'gameplay', '游戏脚本'); add('mod', 'textures', 'textures', '材质 / 贴图');
  for (const type of ['survivor', 'weapon', 'infected', 'item', 'mod']) add(type, 'other', 'unknown', type === 'survivor' ? '未识别角色' : type === 'mod' ? '未识别内容' : '未细分');
  const catalog = { types, groups, targets };
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.SafehouseCatalog = catalog;
})(globalThis);

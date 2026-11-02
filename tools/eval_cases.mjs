// 共用的 Agent 评测用例（24 条），本地规则引擎与大模型路径共用。
export const hasAct = (res, type, extra = {}) =>
  (res.actions || []).some((a) => a.type === type && Object.entries(extra).every(([k, v]) => a[k] === v));

export const replyHas = (res, ...words) => words.every((w) => String(res.reply).includes(w));

const EXHIBIT_NAMES = ['电视', '收音机', '算盘', '公用电话', '台扇', 'CRT', '软盘', '传真机', '计算器', '挂钟', '售货机', '收银台', '冷柜', '自动门', '灯塔'];
export const countExhibitNames = (reply) => EXHIBIT_NAMES.filter((n) => String(reply).includes(n)).length;

export const cases = [
  { text: '带我去看传真机', expect: 'goto(fax)', check: (r) => hasAct(r, 'goto', { id: 'fax' }) },
  { text: '带我去看自动售货机', expect: 'goto(vending)', check: (r) => hasAct(r, 'goto', { id: 'vending' }) },
  { text: '带我去看 CRT 电脑', expect: 'goto(crt)', check: (r) => hasAct(r, 'goto', { id: 'crt' }) },
  { text: '带我去看算盘', expect: 'goto(abacus)', check: (r) => hasAct(r, 'goto', { id: 'abacus' }) },
  { text: '带我去看灯塔', expect: 'goto(lighthouse)', check: (r) => hasAct(r, 'goto', { id: 'lighthouse' }) },
  { text: '带我去看软盘', expect: 'goto(floppy)', check: (r) => hasAct(r, 'goto', { id: 'floppy' }) },
  { text: '带我去看收银台', expect: 'goto(checkout)', check: (r) => hasAct(r, 'goto', { id: 'checkout' }) },
  { text: '切换 1994 办公室', expect: 'switchEra(1994)', check: (r) => hasAct(r, 'switchEra', { era: '1994' }) },
  { text: '带我逛海边便利店', expect: 'switchEra(mart)', check: (r) => hasAct(r, 'switchEra', { era: 'mart' }) },
  { text: '算盘和计算器有什么不同', expect: '对比：算盘/计算器', check: (r) => replyHas(r, '算盘', '计算器') },
  { text: '公用电话和传真机有什么区别', expect: '对比：公用电话/传真机', check: (r) => replyHas(r, '公用电话', '传真机') },
  { text: '电视和 CRT 电脑有什么不同', expect: '对比：电视/CRT', check: (r) => replyHas(r, '电视', 'CRT') },
  { text: '传真机当年多少钱', expect: '价格（日元）', check: (r) => replyHas(r, '日元') },
  { text: '数码是怎么进化的', expect: 'openEvolution', check: (r) => hasAct(r, 'openEvolution') },
  { text: '有什么展品', expect: '说明 15 件 / 列展品', check: (r) => replyHas(r, '15') || countExhibitNames(r.reply) >= 3 },
  { text: '给我一条 5 分钟精华路线', expect: 'startRoute(5分钟精华)', check: (r) => hasAct(r, 'startRoute', { route: '5分钟精华' }) },
  { text: '自主巡展', expect: 'startTour', check: (r) => hasAct(r, 'startTour') },
  {
    text: '生成参观报告',
    ctx: { memory: { visited: [{ id: 'tv', name: '黑白电视机', scene: '1980' }], startedAt: Date.now() } },
    expect: 'openReport',
    check: (r) => hasAct(r, 'openReport'),
  },
  { text: '你好', expect: '自我介绍含「小奖」', check: (r) => replyHas(r, '小奖') || replyHas(r, '讲解员') },
  {
    text: '它当年多少钱',
    ctx: { selectedId: 'abacus' },
    expect: '上下文指代 → 算盘/价格',
    check: (r) => replyHas(r, '算盘', '日元'),
  },
  {
    text: '上次我看了什么',
    ctx: { memory: { visited: [{ id: 'payphone', name: '公用电话', scene: '1980' }], startedAt: Date.now() } },
    expect: '记忆引用',
    check: (r) => replyHas(r, '公用电话'),
  },
  { text: '介绍一下数码考古馆', expect: '本馆介绍', check: (r) => replyHas(r, '数码考古馆', '15') },
  {
    text: '随便说点我不知道的',
    expect: '兜底引导 / 有据可查的冷知识',
    check: (r) => replyHas(r, '没听懂') || replyHas(r, '没找到') || hasAct(r, 'goto') || replyHas(r, '日元'),
  },
  { text: '谢谢', expect: '致谢回复', check: (r) => replyHas(r, '不客气') },
];

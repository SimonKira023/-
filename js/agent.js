// 数码考古馆 · AI 讲解员「小奖」
// 本地规则引擎 + 可选 LLM 后端（/api/chat）；带记忆、规划轨迹、自主巡展/报告动作。
// 纯 ESM，无浏览器依赖（Node 也可直接 import 做评测）。

export function createAgent(data) {
  const exhibits = data.exhibits || [];
  const byId = new Map(exhibits.map((e) => [e.id, e]));
  const routes = data.routes || {};
  const eraMeta = (era) => data.meta?.eras?.[era] || { label: era, desc: '' };
  const ERA_IDS = Object.keys(data.meta?.eras || {});

  const norm = (s) => String(s || '').toLowerCase().replace(/[\s，。！？、,.!?：:；;"'“”‘’()（）]/g, '');
  const has = (text, kws) => kws.some((k) => norm(text).includes(norm(k)));
  const listByEra = (era) => exhibits.filter((e) => e.scene === era);
  const otherEra = (era) => ERA_IDS.find((x) => x !== era) || era;

  function scoreExhibit(e, text) {
    const n = norm(text);
    if (!n) return 0;
    let score = 0;
    if (n.includes(norm(e.name))) score += 60;
    if (n.includes(norm(e.id))) score += 40;
    (e.tags || []).forEach((tag) => { if (n.includes(norm(tag))) score += 22; });
    if (n.includes(norm(e.category))) score += 8;
    if (n.includes(norm(e.year))) score += 6;
    return score;
  }
  function matchExhibits(text, threshold = 16) {
    return exhibits.map((e) => ({ e, s: scoreExhibit(e, text) }))
      .filter((x) => x.s >= threshold)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
  }
  function detectEra(text) {
    const n = norm(text);
    if (/(1980|八十|80年代|80s|五金|商店)/.test(n)) return '1980';
    if (/(1994|九十|90年代|90s|办公室|办公)/.test(n)) return '1994';
    if (/(海边|便利店|mart|灯塔|售货机)/.test(n)) return 'mart';
    return null;
  }
  const eraLabel = (era) => eraMeta(era).label;

  function eraLine(era) {
    const m = eraMeta(era);
    return `${m.label}（${m.desc}）`;
  }
  function describe(e) {
    return `**${e.name}** · ${e.year}\n${e.tagline}\n${e.desc}\n当年价格：${e.price}`;
  }
  function comparePair(a, b) {
    return `**${a.name}**（${a.year}，${a.price}）\n${a.tagline}\n\n**${b.name}**（${b.year}，${b.price}）\n${b.tagline}\n\n共同点：它们都在解决“把信息装进生活”的问题；不同点是前者解决“有没有”，后者解决“快不快、方不方便”。`;
  }

  const STYLES = {
    vhs: { label: '1980s 家庭录像', words: ['家庭录像', 'vhs', '录像带', '家用摄像机'], params: { focal: 35, fstop: 4, shutter: 60, iso: 400, wb: 3400, ev: 0.1, saturation: 0.88, focus: 12 } },
    news: { label: '1990s 电视新闻', words: ['电视新闻', '新闻', '纪录片', '纪实'], params: { focal: 50, fstop: 5.6, shutter: 125, iso: 400, wb: 5600, ev: 0, saturation: 1.05, focus: 0 } },
    night: { label: '低照度夜景', words: ['夜景', '夜晚', '低照度', '暗光'], params: { focal: 35, fstop: 2, shutter: 15, iso: 1600, wb: 3100, ev: -0.2, saturation: 0.9, focus: 20 } },
    film: { label: '电影感', words: ['电影感', '电影', '胶片感', '文艺'], params: { focal: 50, fstop: 2.8, shutter: 30, iso: 400, wb: 5200, ev: -0.2, saturation: 1.0, focus: 8 } },
    bw: { label: '黑白', words: ['黑白', '单色'], params: { focal: 35, fstop: 4, shutter: 60, iso: 800, wb: 5600, ev: 0, saturation: 0.22, focus: 0 } },
    sunny: { label: '阳光海滩', words: ['阳光', '海滩', '夏天', '明亮'], params: { focal: 28, fstop: 8, shutter: 250, iso: 100, wb: 6000, ev: 0.3, saturation: 1.1, focus: 0 } },
    retro: { label: '复古胶片', words: ['复古', '胶片', '怀旧', '老照片'], params: { focal: 40, fstop: 2.8, shutter: 60, iso: 400, wb: 4800, ev: 0.2, saturation: 0.9, focus: 0 } },
  };

  function styleParams(params) {
    return Object.entries(params).map(([k, v]) => `${k}=${v}`).join('，');
  }

  const COMPARE = {
    '算盘': ['abacus', 'calculator'],
    '计算': ['abacus', 'calculator'],
    '电话': ['payphone', 'fax'],
    '通讯': ['payphone', 'fax'],
    '电视': ['tv', 'crt'],
    '屏幕': ['tv', 'crt'],
    '电脑': ['crt', 'floppy'],
    '存储': ['floppy', 'crt'],
    '零售': ['vending', 'checkout'],
    '收银': ['vending', 'checkout'],
    '时间': ['clock', 'lighthouse'],
  };

  // ---------------- 规划轨迹 ----------------
  const TOOL_LABEL = {
    switchEra: '切换展厅',
    goto: '转头定位展品',
    highlight: '高亮展品',
    openEvolution: '打开数码进化树',
    openRoute: '打开参观路线',
    startRoute: '启动主题路线',
    startTour: '启动自主巡展',
    openReport: '生成参观报告',
    openCamera: '打开老式摄像机',
    simulate: '展品使用模拟',
    camera: '调整摄像机参数',
    search: '检索知识库',
    compare: '对比讲解',
  };

  function intentLabel(text, res) {
    if (res.actions?.some((a) => a.type === 'openCamera')) return '打开老式摄像机';
    if (res.actions?.some((a) => a.type === 'camera')) return '调整摄像机参数';
    if (res.actions?.some((a) => a.type === 'simulate')) return '展品使用模拟';
    if (res.actions?.some((a) => a.type === 'startTour')) return '自主巡展请求';
    if (res.actions?.some((a) => a.type === 'openReport')) return '参观报告请求';
    if (res.actions?.some((a) => a.type === 'openEvolution')) return '数码史 / 进化树';
    if (has(text, ['路线', '怎么逛', '推荐'])) return '参观路线推荐';
    if (has(text, ['对比', '比较', '区别', '不同', '差别'])) return '器物 / 年代对比';
    if (res.actions?.some((a) => a.type === 'goto')) return '带路 + 展品讲解';
    if (res.actions?.some((a) => a.type === 'switchEra')) return '切换展厅';
    if (has(text, ['多少钱', '价格', '贵'])) return '价格 / 生活史问答';
    return '知识库问答';
  }

  function buildTrace(text, res, ctx) {
    const steps = [{ kind: 'think', text: `理解意图：${intentLabel(text, res)}` }];
    const matched = matchExhibits(text);
    if (matched[0]) {
      steps.push({ kind: 'think', text: `检索知识库：命中「${matched[0].name}」（${eraLabel(matched[0].scene)}，${matched[0].year}）` });
    }
    if (ctx?.memory?.visited?.length && has(text, ['上次', '刚才', '之前', '又'])) {
      steps.push({ kind: 'think', text: `读取参观记忆：最近看过 ${ctx.memory.visited.slice(-1)[0].name}` });
    }
    (res.actions || []).forEach((a) => {
      steps.push({ kind: 'tool', tool: a.type, args: a, text: `${TOOL_LABEL[a.type] || a.type}${a.id ? `(${byId.get(a.id)?.name || a.id})` : a.era ? `(${a.era})` : a.route ? `(${a.route})` : ''}` });
    });
    steps.push({ kind: 'done', text: '组织讲解并回答' });
    return steps;
  }

  function withTrace(res, text, ctx) {
    return { ...res, trace: buildTrace(text, res, ctx) };
  }

  function localRespond(text, ctx = {}) {
    const era = detectEra(text);
    const matches = matchExhibits(text);
    const first = matches[0];
    const memory = ctx.memory || {};

    // 参观报告
    if (has(text, ['参观报告', '报告', '总结', '回顾', '记录'])) {
      const n = (memory.visited || []).length;
      return withTrace({
        reply: n
          ? `我根据你刚才走过的 ${n} 件展品生成了一份**参观报告**，里面有你的数码时间线和一句话总结。`
          : '你还没开始逛，我先带你走一段，结束后就能生成报告。',
        actions: [{ type: 'openReport' }],
        chips: ['自主巡展', '数码进化树', '有什么展品'],
      }, text, ctx);
    }

    // 自主巡展
    if (has(text, ['自主', '自己带', '自动导览', '自动巡展', '巡展', '你带我逛', '自己逛'])) {
      return withTrace({
        reply: '好，进入**自主巡展**：我会自己选展品、自己切场景、边走边讲，你可以随时打断我。',
        actions: [{ type: 'startTour', route: '5分钟精华' }],
        chips: ['停下', '生成参观报告', '有什么展品'],
      }, text, ctx);
    }

    // 长焦 / 数码变焦 / 画质问题：给物理玻璃方案
    if (has(text, ['拍远', '长焦', '增距', '玻璃', '太模糊', '模糊', '数码变焦', '放大', '看不清', '拍清楚'])) {
      const digital = has(text, ['数码变焦', '裁切', '放大']);
      if (digital) {
        return withTrace({
          reply: '数码变焦只是把画面裁切放大，越远越糊——这是算法补不回来的。想要真正拍远，老一辈的做法是**换长焦玻璃**或**加增距镜**：135mm 镜头 + 1.4× 增距镜 ≈ 189mm，代价是更重、更贵、光圈变小（进光少）。我已经帮你换成 135mm + ×1.4 增距镜（物理方案），数码变焦保持 ×1。',
          actions: [{ type: 'camera', focal: 135, tele: 1.4 }],
          chips: ['再远一点', '调亮一点', '拍一张', '退出摄像机'],
        }, text, ctx);
      }
      return withTrace({
        reply: '想拍更远，优先用**物理玻璃**：把镜头拧到 135mm，或装 1.4×/2× 增距镜（等效焦距变长、清晰度仍在）；数码变焦只是裁切，越放越糊。物理方案更重更贵、光圈也会变小，但画质保得住。已帮你切到 135mm + ×1.4 增距镜。',
        actions: [{ type: 'camera', focal: 135, tele: 1.4 }],
        chips: ['用 2× 增距镜', '数码变焦试一下', '拍一张', '退出摄像机'],
      }, text, ctx);
    }

    // 风格化调参（一句话让 AI 调摄像机）
    const styleIntent = has(text, ['风格', '感觉', '调成', '调到', '拍成', '画面', '镜头', '想要', '像', '一点']);
    for (const key of Object.keys(STYLES)) {
      const st = STYLES[key];
      if (styleIntent && has(text, st.words)) {
        const extra = [st.params.focal ? `${Math.round(st.params.focal)}mm` : '', st.params.fstop ? `f/${st.params.fstop}` : '', st.params.iso ? `ISO${st.params.iso}` : '', st.params.wb ? `${st.params.wb}K` : ''].filter(Boolean).join(' ');
        return withTrace({
          reply: `收到，我把摄像机调成 **${st.label}** 风格：${st.params.focal ? `${Math.round(st.params.focal)}mm ` : ''}${st.params.fstop ? `f/${st.params.fstop} ` : ''}${st.params.iso ? `ISO ${st.params.iso} ` : ''}${st.params.wb ? `${st.params.wb}K ` : ''}${st.params.saturation < 0.4 ? '黑白' : ''}。打开专家模式就能看到这些真实参数，也可以继续微调。`,
          actions: [{ type: 'cameraStyle', style: key, label: st.label, params: st.params }],
          chips: ['再来一个电影感', '调亮一点', '拍一张', '专家模式'],
        }, text, ctx);
      }
    }

    // 摄像机参数调整（AI 参与调参）
    if (has(text, ['变焦', '拉近', '推近', '放大', '广角', '拉远', '曝光', '调亮', '亮一点', '调暗', '暗一点', '颗粒', '噪点', '暖色', '冷色', '滤镜'])) {
      const p = {};
      const notes = [];
      if (/(拉近|推近|放大|变焦)/.test(text)) { p.zoom = 30; notes.push('镜头拉近到 30° 视角'); }
      if (/(广角|拉远|退远)/.test(text)) { p.zoom = 70; notes.push('镜头拉远到 70° 视角'); }
      if (/(调亮|亮一点|曝光不足|太暗)/.test(text)) { p.exposure = 1.35; notes.push('曝光 +35%'); }
      if (/(调暗|暗一点|太亮|过曝)/.test(text)) { p.exposure = 0.7; notes.push('曝光 −30%'); }
      if (/(颗粒|噪点|糙)/.test(text)) { p.grain = 0.17; notes.push('颗粒加重'); }
      if (/(干净|清晰|少点颗粒)/.test(text)) { p.grain = 0.03; notes.push('颗粒减弱'); }
      if (/(暖|黄)/.test(text)) { p.warm = 0.25; notes.push('色调更暖'); }
      if (/(冷|蓝|青)/.test(text)) { p.warm = -0.12; notes.push('色调更冷'); }
      if (!notes.length) { p.zoom = 34; notes.push('镜头拉近一点'); }
      return withTrace({
        reply: `已帮你调整摄像机：${notes.join('，')}。想再调可以继续说“再拉近一点 / 调亮一点 / 颗粒少一点”，或直接按空格拍照。`,
        actions: [{ type: 'camera', ...p }],
        chips: ['再拉近一点', '调亮一点', '拍一张', '退出摄像机'],
      }, text, ctx);
    }

    // 展品使用模拟
    if (has(text, ['使用模拟', '模拟', '怎么用', '用一下', '用一次', '试一下', '演示一下', '怎么操作', '开机', '投币', '拨号', '扫码', '打开冷柜', '走近自动门'])) {
      const target = first || (ctx.selectedId ? byId.get(ctx.selectedId) : null);
      if (target) {
        return withTrace({
          reply: `打开 **${target.name}** 的使用模拟：${target.use_label || '用一下'}，可以听到那个年代的真实操作声音。`,
          actions: [{ type: 'simulate', id: target.id }],
          chips: ['再试一次', '有什么展品', '退出模拟'],
        }, text, ctx);
      }
      return withTrace({
        reply: '想看哪件展品的「使用模拟」？先说“带我去看××”，或者点展品卡上的「使用模拟」。',
        chips: ['带我去看黑白电视机', '带我去看传真机', '有什么展品'],
      }, text, ctx);
    }

    // 打开老式摄像机
    if (has(text, ['摄像机', '拍照', '相機', '相机', '摄影', '胶片', '拍一张', '拍张照'])) {
      return withTrace({
        reply: '好的，打开**老式摄像机**模式：4:3 取景、VHS 磁带质感，可以拖动看四周、WASD 移动机位、滚轮变焦，按空格或「拍照」键留下当年的画面。',
        actions: [{ type: 'openCamera' }],
        chips: ['拍一张', '退出摄像机', '有什么展品'],
      }, text, ctx);
    }

    // 帮助/自我介绍
    if (has(text, ['你好', 'hi', 'hello', '你是谁', '你能做什么', '怎么用', '帮助', 'help', '怎么玩'])) {
      return withTrace({
        reply: '我是数码考古馆的 AI 讲解员**小奖**。我能：\n① 带你去展品前，转头、变焦、高亮后讲解（“带我去看传真机”）\n② 切换 1980 商店 / 1994 办公室 / 海边便利店\n③ 做年代与器物对比（“算盘和计算器有什么不同”）\n④ 自主巡展：我规划路线，自己带你走完\n⑤ 记住你看了什么，生成参观报告。',
        chips: ['带我去看自动售货机', '算盘和计算器有什么不同', '自主巡展', '生成参观报告'],
      }, text, ctx);
    }

    // 上次/记忆
    if (has(text, ['上次', '刚才', '之前', '还记得', '又见'])) {
      const recent = (memory.visited || []).slice(-3);
      if (recent.length) {
        return withTrace({
          reply: `当然记得。你最近看过：${recent.map((v) => `**${v.name}**（${eraLabel(v.scene)}）`).join('、')}。要不要从其中一件接着看，或者生成一份参观报告？`,
          actions: [{ type: 'goto', id: recent[recent.length - 1].id }],
          chips: ['生成参观报告', '带我去看 CRT 电脑', '有什么展品'],
        }, text, ctx);
      }
    }

    // 关于本馆
    if (has(text, ['数码考古馆', '这个馆', '这座馆', '博物馆', '介绍自己'])) {
      return withTrace({
        reply: '**数码考古馆**是一间 360° 实景数字博物馆：三个展厅（1980 五金商店 / 1994 办公室 / 海边便利店）全部由游戏原始场景渲染，保留原光影；馆里有 15 件与"数码如何进入生活"相关的展品。我可以带路、讲解、对比、自主巡展，也能生成你的参观报告。',
        chips: ['带我去看传真机', '自主巡展', '生成参观报告', '有什么展品'],
      }, text, ctx);
    }

    // 感谢
    if (has(text, ['谢谢', '感谢', '辛苦了', '厉害', '不错'])) {
      return withTrace({
        reply: '不客气，能一起把这些老物件的故事讲出来，我也很高兴。还想看什么，随时叫我。',
        chips: ['生成参观报告', '自主巡展', '数码进化树'],
      }, text, ctx);
    }

    // 三场景对比
    if (has(text, ['三个场景', '场景区别', '有什么场景', '几个展厅', '有哪些场景'])) {
      return withTrace({
        reply: '馆里有三个 360° 实景展厅：\n· **1980 · 五金商店**：电视、收音机、公用电话、算盘——数码进入家庭的前夜；\n· **1994 · 办公室**：CRT 电脑、软盘、传真机、计算器——办公室数字化；\n· **海边 · 便利店**：售货机、收银台、冷柜、自动门、灯塔——零售与公共设施的数字化。',
        chips: ['带我逛 1980 商店', '带我逛 1994 办公室', '带我去海边便利店'],
      }, text, ctx);
    }

    // 进化树
    if (has(text, ['进化', '时间线', '发展史', '历史', '演变', '数码史'])) {
      return withTrace({
        reply: '我打开 **数码进化树** 了：算盘 → 收音机 → 电视 → 公用电话 / 售货机 → 自动门 / 冷柜 → CRT 电脑 / 软盘 → 传真机 / 计算器 → 手机 / 云。点任意节点，我带你去看实物。',
        actions: [{ type: 'openEvolution' }],
        chips: ['带我去看算盘', '带我去看 CRT 电脑', '带我去看自动售货机'],
      }, text, ctx);
    }

    // 路线
    if (has(text, ['路线', '参观路线', '怎么逛', '推荐', '不知道看什么', '5分钟', '精华'])) {
      const names = Object.keys(routes);
      if (text.includes('5') || text.includes('精华')) {
        return withTrace({
          reply: '给你一条 **5 分钟精华路线**：电视 → 公用电话 → CRT 电脑 → 传真机 → 自动售货机。跟着我走，我会逐件讲解。',
          actions: [{ type: 'startRoute', route: '5分钟精华' }],
          chips: ['通讯线', '办公线', '海边线'],
        }, text, ctx);
      }
      return withTrace({
        reply: `我准备了几条路线：**${names.join(' / ')}**。选一条，我就按顺序带你走。`,
        actions: [{ type: 'openRoute' }],
        chips: names.concat(['带我去看软盘']),
      }, text, ctx);
    }

    // 对比
    if (has(text, ['对比', '比较', '区别', '不同', '变化', '差别', '比一比'])) {
      for (const key of Object.keys(COMPARE)) {
        if (norm(text).includes(norm(key))) {
          const [aId, bId] = COMPARE[key];
          const a = byId.get(aId), b = byId.get(bId);
          if (a && b) {
            return withTrace({
              reply: comparePair(a, b),
              actions: [{ type: 'goto', id: a.id }],
              chips: [`带我去看${b.name}`, '有什么展品', '数码进化树'],
            }, text, ctx);
          }
        }
      }
      if (matches.length >= 2) {
        return withTrace({
          reply: comparePair(matches[0], matches[1]),
          actions: [{ type: 'goto', id: matches[0].id }],
          chips: [`带我去看${matches[1].name}`, '有什么展品'],
        }, text, ctx);
      }
      return withTrace({
        reply: '可以对比同年代的器物（如“算盘和计算器”），也可以对比两个年代（说“1980 和 1994 有什么不同”）。你想比哪一组？',
        chips: ['算盘和计算器', '公用电话和传真机', '电视和 CRT 电脑'],
      }, text, ctx);
    }

    // 代词指代
    if (has(text, ['它', '这个', '这件', '刚才']) && ctx.selectedId && byId.get(ctx.selectedId)) {
      const e = byId.get(ctx.selectedId);
      return withTrace({ reply: describe(e), actions: [{ type: 'goto', id: e.id }] }, text, ctx);
    }

    // 场景级请求（切换 / 逛）：优先于「标签误匹配成展品」的情况
    const goVerb = has(text, ['带我去看', '带我看', '看看', '看一下', '介绍', '讲解', '参观', '走到', '飞到', '带我去']);
    const sceneVerb = has(text, ['切换', '换到', '换去', '带我逛', '逛逛', '逛', '去逛']);
    if (era && sceneVerb && !goVerb) {
      const list = listByEra(era).map((e) => e.name).join('、');
      return withTrace({
        reply: `好，切换到 **${eraLine(era)}**。这个场景有：${list}。要不要我带你看其中一件？`,
        actions: [{ type: 'switchEra', era }],
        chips: listByEra(era).slice(0, 3).map((e) => `带我去看${e.name}`),
      }, text, ctx);
    }

    // 指定展品
    if (first) {
      const wantGo = has(text, ['带我去', '带我看', '去', '看看', '走到', '飞到', '参观', '看', '带我']);
      const askPrice = has(text, ['多少钱', '价格', '贵', '工资', '值']);
      if (wantGo) {
        return withTrace({
          reply: `好，这就带你去 **${first.name}**。\n${first.tagline}\n${first.desc}`,
          actions: [{ type: 'goto', id: first.id }, { type: 'highlight', id: first.id }],
          chips: ['它当年多少钱', '数码进化树', '有什么展品'],
        }, text, ctx);
      }
      if (askPrice) {
        return withTrace({
          reply: `**${first.name}**（${first.year}）当年价格：${first.price}。放进当年的生活水平看，它属于什么消费？这正是数码产品后来普及的意义。`,
          actions: [{ type: 'goto', id: first.id }],
          chips: ['数码进化树', '有什么展品'],
        }, text, ctx);
      }
      return withTrace({
        reply: describe(first),
        actions: [{ type: 'goto', id: first.id }],
        chips: ['它当年多少钱', '数码进化树', '有什么展品'],
      }, text, ctx);
    }

    // 只切场景
    if (era) {
      const list = listByEra(era).map((e) => e.name).join('、');
      return withTrace({
        reply: `切换到 **${eraLine(era)}**。这个场景有：${list}。要不要我带你看其中一件？`,
        actions: [{ type: 'switchEra', era }],
        chips: listByEra(era).slice(0, 3).map((e) => `带我去看${e.name}`),
      }, text, ctx);
    }

    // 列展品
    if (has(text, ['有什么', '有哪些', '展品', '收藏', '清单'])) {
      const lines = ERA_IDS.map((id) => `**${eraMeta(id).label}**\n` + listByEra(id).map((e) => `· ${e.name}（${e.tagline}）`).join('\n')).join('\n\n');
      return withTrace({
        reply: `馆里现在有 **${exhibits.length} 件展品**：\n\n${lines}\n\n说“带我去看××”我就带你过去。`,
        chips: ['带我去看软盘', '带我去看自动售货机', '5 分钟精华路线'],
      }, text, ctx);
    }

    // 模糊兜底
    if (first) {
      return withTrace({
        reply: `你是想了解 **${first.name}** 吗？\n${first.tagline}\n${first.desc}`,
        actions: [{ type: 'goto', id: first.id }],
      }, text, ctx);
    }

    const alt = otherEra(ctx.era || '1980');
    return withTrace({
      reply: `我暂时没听懂。试试：\n· “带我去看自动售货机”\n· “算盘和计算器有什么不同”\n· “自主巡展”\n· “生成参观报告”\n· “${eraLabel(alt)}有什么？”`,
      chips: ['带我去看传真机', '有什么展品', '5 分钟精华路线', '数码进化树'],
    }, text, ctx);
  }

  // ---------------- LLM 后端 ----------------
  async function llmRespond(text, ctx = {}) {
    if (!globalThis.MUSEUM_CONFIG?.allowLLM) return null;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          era: ctx.era,
          selected: ctx.selectedId,
          history: (ctx.history || []).slice(-8),
          memory: ctx.memory || null,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.reply) return null;
      const actions = Array.isArray(data.actions) ? data.actions.filter((a) => {
        if (a.type === 'switchEra') return ERA_IDS.includes(a.era);
        if (a.type === 'goto' || a.type === 'highlight') return byId.has(a.id);
        if (a.type === 'simulate') return byId.has(a.id);
        return ['openEvolution', 'openRoute', 'startRoute', 'startTour', 'openReport', 'openCamera', 'camera', 'cameraStyle'].includes(a.type);
      }) : [];
      const plan = Array.isArray(data.plan) ? data.plan : [];
      const trace = plan.length
        ? [{ kind: 'think', text: '大模型规划中…' }, ...plan.map((p) => ({ kind: 'think', text: String(p) })), ...actions.map((a) => ({ kind: 'tool', tool: a.type, args: a, text: `${TOOL_LABEL[a.type] || a.type}` })), { kind: 'done', text: '生成回答' }]
        : buildTrace(text, { actions }, ctx);
      return { reply: data.reply, actions, trace, source: data.source || 'llm' };
    } catch (err) { return null; }
  }

  return {
    exhibits, byId, eraMeta, routes, localRespond, llmRespond, buildTrace,
    async respond(text, ctx = {}) {
      // 摄像机 / 使用模拟是确定性界面动作：无论本地还是大模型模式，都直接交给本地分支，
      // 避免模型把它们当成“展品查询”而拒绝。
      if (has(text, ['打开摄像机', '开摄像机', '摄像机', '拍照', '拍一张', '拍张照', '相机', '摄影',
        '变焦', '拉近', '推近', '放大', '广角', '拉远', '曝光', '调亮', '调暗', '颗粒', '噪点', '暖色', '冷色', '滤镜',
        '风格', '家庭录像', '电视新闻', '夜景', '电影感', '黑白', '阳光', '复古', '胶片', '氛围', '感觉',
        '拍远', '长焦', '增距', '玻璃', '太模糊', '数码变焦', '看不清',
        '使用模拟', '模拟', '怎么用', '用一下', '用一次', '试一下', '演示一下', '怎么操作'])) {
        const local = localRespond(text, ctx);
        return { ...local, source: 'local' };
      }
      const llm = await llmRespond(text, ctx);
      if (llm) return llm;
      const local = localRespond(text, ctx);
      return { ...local, source: 'local' };
    },
  };
}

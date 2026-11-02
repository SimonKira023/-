# -*- coding: utf-8 -*-
"""Build exhibits.json for the panorama museum from Godot-rendered node dumps."""
import json, math, os, shutil, sys

BASE = r'D:\Download\Deepseek Working\数码考古馆'
PANO = os.path.join(BASE, 'pano')
OUT = os.path.join(BASE, 'data', 'exhibits.json')
ASSETS = os.path.join(BASE, 'assets', 'pano')
os.makedirs(ASSETS, exist_ok=True)

SCENES = {
    'shop': {'dir': 'shop2', 'pano': 'shop.jpg', 'label': '1980 · 五金商店', 'desc': '街角的「金五桥高」五金店，电视、收音机、公用电话的年代'},
    'office': {'dir': 'office', 'pano': 'office.jpg', 'label': '1994 · 办公室', 'desc': '东京 1994 年的办公室，CRT 电脑、软盘与传真机的年代'},
    'mart': {'dir': 'mart', 'pano': 'mart.jpg', 'label': '海边 · 便利店', 'desc': '海边小镇的「なみのね」便利店，售货机、收银台与灯塔'},
}

# (scene, exhibition node position override)
EXHIBITS = [
    # ---- 1980 五金商店 ----
    dict(id='tv', scene='shop', node='hotspot-tv', y_off=0.75,
         name='黑白电视机', year='1980 年代', category='影音',
         price='当年约 10–20 万日元（普通家庭数月收入）',
         tagline='一台电视，一屋子人',
         desc='晚饭后邻居搬着小板凳来看电视，信号不好时还要有人扶着天线。它第一次把“外面的世界”搬进了普通人家，也是全家人围坐的理由。',
         tags=['电视', '影音', '1980', '家庭娱乐', '黑白电视']),
    dict(id='radio', scene='shop', node='hotspot-radio',
         name='台式收音机', year='1980 年代', category='影音',
         price='当年约 1–2 万日元',
         tagline='声音是那个年代的信息高速公路',
         desc='电视普及之前，收音机是家庭获取新闻、评书和音乐的主要入口。旋钮调台、拉长天线、沙沙的电流声，是很多人对“数字时代前夜”的共同记忆。',
         tags=['收音机', '广播', '1980', '影音']),
    dict(id='abacus', scene='shop', node='hotspot-abacus',
         name='算盘', year='前数码时代', category='计算',
         price='当年约 1000–3000 日元',
         tagline='在芯片之前，人们用珠子计算',
         desc='算盘是最早的计算设备之一：珠子是存储，口诀是算法。它后来被电子计算器和电脑取代，却留下了“精打细算”的做事方式——这是数码史绕不开的起点。',
         tags=['算盘', '计算', '前数码', '商店']),
    dict(id='payphone', scene='shop', node='public-phone', y_off=1.2,
         name='公用电话', year='1980 年代', category='通讯',
         price='通话约 10 日元/次',
         tagline='BP 机响了，就去找它',
         desc='公用电话是那个年代的“移动通讯基站”：排队、投币、喊人、传话。它连接了街坊、异地的家人和第一批下海做生意的人，也是手机时代的前传。',
         tags=['公用电话', '通讯', '1980', 'BP机', '电话']),
    dict(id='fan', scene='shop', node='desk-fan',
         name='台扇与吊扇', year='1980 年代', category='家电',
         price='当年约 1–2 万日元',
         tagline='没有空调的夏天，靠它续命',
         desc='在空调进入家庭之前，台扇和吊扇是夏天的全部凉意。三档风速、定时旋钮、嗡嗡的电机声——家电的“档位逻辑”从那时起就刻进了我们的操作习惯。',
         tags=['电扇', '家电', '1980', '夏天', '空调前身']),

    # ---- 1994 办公室 ----
    dict(id='crt', scene='office', node='CRTBody',
         name='CRT 台式电脑', year='1990 年代', category='电脑',
         price='当年约 30–60 万日元',
         tagline='大头显示器里，第一次有了自己的桌面',
         desc='厚实的 CRT 显示器、卧式主机、机械键盘和 3.5 英寸软驱，是 1990 年代办公室的标准配置。开机要等自检、存盘要插软盘，但那是很多人第一次真正“拥有”一台电脑。',
         tags=['电脑', 'CRT', '1994', '台式机', '键盘']),
    dict(id='floppy', scene='office', node='FloppySlotA', y_off=0.5,
         name='3.5 英寸软盘与软驱', year='1990 年代', category='存储',
         price='软盘约 300–500 日元/张（1.44MB）',
         tagline='把文件“装进口袋”的年代',
         desc='一张软盘只有 1.44MB，装不下一张现在的高清照片。写报告、交作业、拷游戏，都要先“存盘”再“带盘”。它教会了第一代电脑用户：数据是可以随身携带的。',
         tags=['软盘', '软驱', '存储', '1994', 'U盘前身']),
    dict(id='fax', scene='office', node='FaxMachine',
         name='传真机', year='1990 年代', category='通讯',
         price='当年约 10–30 万日元',
         tagline='比快递快，比电话“有据可查”',
         desc='传真机把纸张变成信号、再变成对方桌上的纸。合同、订单、图纸，几分钟就能跨城送达，是 1990 年代商务的“硬通货”。今天它被扫描件和电子邮件取代，但“传真”两个字还留在很多流程里。',
         tags=['传真机', '通讯', '1994', '商务', '电子邮件前身']),
    dict(id='calculator', scene='office', node='Calculator',
         name='电子计算器', year='1980–90 年代', category='计算',
         price='当年约 3000–10000 日元',
         tagline='算盘的电子化接班人',
         desc='按键、液晶屏、太阳能电池板——电子计算器把算盘的口诀变成了电路。它便宜、可靠、不用联网，至今仍躺在很多人的抽屉里，是“数码替代传统工具”最安静的一次革命。',
         tags=['计算器', '计算', '1994', '液晶', '算盘后继']),
    dict(id='clock', scene='office', node='WallClock',
         name='办公室挂钟', year='1990 年代', category='时间',
         price='当年约 3000–8000 日元',
         tagline='打卡、开会、赶末班车的时间坐标',
         desc='在手机看时间之前，墙上那面钟决定了办公室的节奏。它提醒我们：数码设备替代的往往不是某件东西，而是一整套生活秩序。',
         tags=['挂钟', '时间', '1994', '办公室']),

    # ---- 海边便利店 ----
    dict(id='vending', scene='mart', node='Hotspot_vending',
         name='自动售货机', year='1980 年代', category='零售',
         price='饮料约 120 日元/瓶',
         tagline='无人零售的雏形',
         desc='投币、按键、出货——自动售货机用最简单的机械逻辑完成了“无人售卖”。它是便利店文化的前身，也是后来无人零售、扫码支付反复致敬的原型。',
         tags=['售货机', '零售', '1980', '无人商店', '投币']),
    dict(id='checkout', scene='mart', node='Hotspot_counter',
         name='收银台与条码', year='1980 年代', category='零售',
         price='收银机约 10–20 万日元',
         tagline='每一次“嘀”声，都是数据',
         desc='收银机把交易变成数字：商品、价格、库存第一次被系统记录。条码和 POS 系统后来让便利店能精确到“几点卖出几瓶水”，这是零售业最早的数字化。',
         tags=['收银台', '条码', 'POS', '零售', '数据']),
    dict(id='cooler', scene='mart', node='Hotspot_cooler',
         name='冷柜', year='1980 年代', category='家电',
         price='当年约 20–40 万日元',
         tagline='让夏天 24 小时都有冰饮',
         desc='冷柜把“冷藏”变成便利店的核心能力：四季都能卖冷饮、便当和冰淇淋。压缩机的嗡嗡声，是那个年代便利店最熟悉的背景音。',
         tags=['冷柜', '家电', '1980', '便利店', '冷链']),
    dict(id='entrance', scene='mart', node='Hotspot_entrance',
         name='自动门', year='1980 年代', category='体验',
         price='当年约 30–50 万日元',
         tagline='第一道“无接触”的数码体验',
         desc='人走近，门自己打开——传感器和电机完成了今天“无接触交互”的雏形。对很多孩子来说，这是他们第一次被一台机器“看见”。',
         tags=['自动门', '传感器', '1980', '便利店', '交互']),
    dict(id='lighthouse', scene='mart', node='Hotspot_lighthouse',
         name='海边灯塔', year='电气化时代', category='信号',
         price='（公共设施）',
         tagline='海边小镇最早的“信号灯”',
         desc='灯塔用光束为夜航的船指路，是电气化时代最浪漫的基础设施。它和今天的导航、定位共享同一个目的：把位置与方向变成可以传递的信息。',
         tags=['灯塔', '信号', '海边', '导航', '电气化']),
]

EVOLUTION = [
    {'year': '古代', 'name': '算盘', 'note': '珠子即存储', 'exhibit': 'abacus'},
    {'year': '1950s', 'name': '收音机', 'note': '声音进入家庭', 'exhibit': 'radio'},
    {'year': '1980s', 'name': '电视', 'note': '画面进入家庭', 'exhibit': 'tv'},
    {'year': '1980s', 'name': '公用电话 / 售货机', 'note': '即时通讯与无人零售', 'exhibit': 'payphone'},
    {'year': '1980s', 'name': '自动门 / 冷柜', 'note': '传感器与家电', 'exhibit': 'entrance'},
    {'year': '1990s', 'name': 'CRT 电脑 / 软盘', 'note': '个人计算与存储', 'exhibit': 'crt'},
    {'year': '1990s', 'name': '传真机 / 计算器', 'note': '办公室数字化', 'exhibit': 'fax'},
    {'year': '2000s+', 'name': '手机 / 云', 'note': '设备消失进生活'},
]

ROUTES = {
    '通讯线': ['payphone', 'fax', 'crt', 'checkout'],
    '办公线': ['floppy', 'calculator', 'crt', 'fax'],
    '海边线': ['vending', 'checkout', 'cooler', 'lighthouse'],
    '5分钟精华': ['tv', 'payphone', 'crt', 'fax', 'vending'],
}


def load_scene(scene_key):
    d = SCENES[scene_key]
    with open(os.path.join(PANO, d['dir'], 'nodes.json'), encoding='utf-8') as f:
        meta = json.load(f)
    meta['_by_name'] = {}
    for n in meta['nodes']:
        meta['_by_name'].setdefault(n['name'], n['position'])
    # copy pano
    src = os.path.join(PANO, d['dir'] + '_pano.jpg')
    dst = os.path.join(ASSETS, d['pano'])
    if not os.path.exists(dst) or os.path.getsize(dst) < os.path.getsize(src):
        shutil.copy2(src, dst)
        print('copied pano', dst, os.path.getsize(dst) // 1024, 'KB')
    return meta


def frame(meta):
    f = meta['camera_forward']; r = meta['camera_right']; u = meta['camera_up']
    def norm(v):
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]
    f = norm(f); u = norm(u)
    r = norm([f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]])
    return f, r, u


def yaw_pitch(pos, cam, f, r, u):
    d = [pos[i] - cam[i] for i in range(3)]
    n = math.sqrt(sum(x * x for x in d)) or 1.0
    d = [x / n for x in d]
    yaw = math.degrees(math.atan2(sum(d[i] * r[i] for i in range(3)), sum(d[i] * f[i] for i in range(3))))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, sum(d[i] * u[i] for i in range(3))))))
    return round(yaw, 2), round(pitch, 2)


scenes = {}
frames = {}
for key in SCENES:
    meta = load_scene(key)
    scenes[key] = meta
    frames[key] = frame(meta)

exhibits = []
for ex in EXHIBITS:
    meta = scenes[ex['scene']]
    cam = meta['camera_position']
    f, r, u = frames[ex['scene']]
    pos = list(meta['_by_name'].get(ex['node'], [0, 0, 0]))
    pos[1] += ex.get('y_off', 0.0)
    yaw, pitch = yaw_pitch(pos, cam, f, r, u)
    item = {k: ex[k] for k in ('id', 'scene', 'name', 'year', 'category', 'price', 'tagline', 'desc', 'tags')}
    item['node'] = ex['node']
    item['yaw'] = yaw
    item['pitch'] = max(-60.0, min(60.0, pitch))
    exhibits.append(item)

assert all(e['id'] for e in exhibits)
by_id = {e['id']: e for e in exhibits}

# validate evolution/routes references
for node in EVOLUTION:
    if 'exhibit' in node and node['exhibit'] not in by_id:
        raise SystemExit('bad evolution ref: ' + node['exhibit'])
for name, ids in ROUTES.items():
    for i in ids:
        if i not in by_id:
            raise SystemExit('bad route ref: ' + name + ' -> ' + i)

data = {
    'meta': {
        'title': '数码考古馆',
        'subtitle': '从算盘到智能设备：一间可以走进去的数字博物馆',
        'note': '所有 360° 场景由 Godot 原场景实时渲染，保留游戏原始光影',
        'eras': {
            key: {
                'label': SCENES[key]['label'],
                'desc': SCENES[key]['desc'],
                'pano': 'assets/pano/' + SCENES[key]['pano'],
                'forward': frames[key][0],
                'right': frames[key][1],
                'up': frames[key][2],
                'camera': scenes[key]['camera_position'],
            } for key in SCENES
        },
    },
    'exhibits': exhibits,
    'evolution': EVOLUTION,
    'routes': ROUTES,
}

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('wrote', OUT, 'exhibits', len(exhibits))
print('yaw/pitch sample:', [(e['id'], e['yaw'], e['pitch']) for e in exhibits[:6]])

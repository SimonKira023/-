// 数码考古馆 · 展品「使用模拟」
// 每个展品一段可交互的模拟使用：Canvas 绘制 + Web Audio 合成音效，无外部素材。
// API: openSimulator(exhibit, { eraLabel })
const $ = (id) => document.getElementById(id);

let audio = null;
function ac() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
  }
  if (audio && audio.state === 'suspended') audio.resume();
  return audio;
}
function tone(freq, dur = 0.12, type = 'square', gain = 0.05, slideTo = null) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, a.currentTime + dur);
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur + 0.02);
}
function noise(dur = 0.4, gain = 0.05, lowpass = 4000) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
function beep(n = 1, freq = 880) {
  for (let i = 0; i < n; i++) setTimeout(() => tone(freq, 0.09, 'square', 0.045), i * 130);
}
function modem() {
  [1200, 2200, 1600, 2400, 900, 1800].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'sine', 0.04), i * 150));
}
function hum(dur = 1.6) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sawtooth';
  o.frequency.value = 78;
  g.gain.value = 0.02;
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

/* ---------------- 画布绘制工具 ---------------- */
const W = 960;
const H = 720;
function rr(ctx, x, y, w, h, r = 10) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function ink(ctx, color) { ctx.fillStyle = color; ctx.strokeStyle = color; }
function label(ctx, text, x, y, size = 20, color = '#d9e2f0', align = 'left', font = 'monospace') {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function crtScreen(ctx, x, y, w, h, color = '#0a1a12') {
  ink(ctx, '#05070b');
  rr(ctx, x - 18, y - 18, w + 36, h + 36, 16);
  ctx.fill();
  ink(ctx, color);
  rr(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.save();
  rr(ctx, x, y, w, h, 10);
  ctx.clip();
}
function scanlines(ctx, x, y, w, h, alpha = 0.18) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ink(ctx, '#000');
  for (let yy = y; yy < y + h; yy += 4) ctx.fillRect(x, yy, w, 1.5);
  ctx.restore();
}

/* ---------------- 各展品模拟 ---------------- */
const TYPES = {
  tv(st) {
    return {
      draw(ctx, t) {
        crtScreen(ctx, 300, 170, 360, 270, st.on ? '#101a16' : '#05070b');
        if (st.on) {
          if (st.mode === 'static') {
            for (let i = 0; i < 900; i++) {
              ink(ctx, `rgba(${180 + Math.random() * 75},${180 + Math.random() * 75},${180 + Math.random() * 75},.35)`);
              ctx.fillRect(300 + Math.random() * 360, 170 + Math.random() * 270, 2, 2);
            }
          } else {
            ink(ctx, '#15352a');
            ctx.fillRect(300, 170, 360, 270);
            ink(ctx, '#7fd0a0');
            ctx.fillRect(300, 170 + 30, 360, 34);
            label(ctx, st.channel === 1 ? 'NHK 総合' : st.channel === 2 ? 'TBS' : 'フジテレビ', 318, 170 + 47, 24, '#0b2018');
            ink(ctx, '#cfe8d8');
            ctx.fillRect(320, 230, 320, 180);
            label(ctx, st.channel === 1 ? '夜のニュース' : 'ドラマ', 350, 260, 26, '#13251c');
            for (let i = 0; i < 4; i++) {
              ink(ctx, '#4b7a63');
              ctx.fillRect(340, 300 + i * 26, 280 - i * 30, 8);
            }
          }
        }
        scanlines(ctx, 300, 170, 360, 270, 0.22);
        ctx.restore();
      },
      action(st) { st.on = !st.on; st.mode = 'static'; setTimeout(() => { st.mode = 'channel'; }, 900); noise(0.5, 0.05); tone(300, 0.2, 'square', 0.03, 120); },
      extras: [{ label: '换台', fn(st) { st.channel = (st.channel % 3) + 1; st.on = true; st.mode = 'channel'; beep(1, 660); } }],
      status: '按下「开机换台」，听电子管电视的启动声',
    };
  },

  radio(st) {
    return {
      draw(ctx) {
        ink(ctx, '#2a2119');
        rr(ctx, 250, 200, 460, 300, 18);
        ctx.fill();
        ink(ctx, '#17120d');
        rr(ctx, 280, 230, 400, 150, 10);
        ctx.fill();
        label(ctx, st.on ? `${st.freq.toFixed(1)} MHz` : 'OFF', 300, 260, 26, st.on ? '#ffd28a' : '#5d5145');
        // 波形
        ctx.save();
        ctx.beginPath();
        for (let x = 0; x <= 360; x++) {
          const y = 330 + Math.sin((x + performance.now() * 0.25) * 0.08) * (st.on ? 28 : 0) * Math.random();
          x === 0 ? ctx.moveTo(300 + x, y) : ctx.lineTo(300 + x, y);
        }
        ink(ctx, '#ffcf8a');
        ctx.stroke();
        ctx.restore();
        // 旋钮
        ink(ctx, '#6b5a45');
        ctx.beginPath(); ctx.arc(320, 430, 26, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(400, 430, 26, 0, 7); ctx.fill();
        label(ctx, '音量', 320, 480, 14, '#b9a585', 'center');
        label(ctx, '调台', 400, 480, 14, '#b9a585', 'center');
      },
      action(st) { st.on = true; st.freq = 82.5; noise(0.5, 0.03, 2200); tone(520, 0.2, 'sawtooth', 0.02); },
      extras: [{ label: '调台', fn(st) { st.freq = 76 + Math.random() * 12; st.on = true; noise(0.35, 0.04, 1800); } }],
      status: '旋转调台旋钮，听老式收音机的沙沙声',
    };
  },

  abacus(st) {
    return {
      draw(ctx) {
        ink(ctx, '#4a2f1e');
        rr(ctx, 210, 150, 540, 420, 14);
        ctx.fill();
        ink(ctx, '#2a1a10');
        rr(ctx, 230, 170, 500, 380, 8);
        ctx.fill();
        ctx.strokeStyle = '#8a623c';
        ctx.lineWidth = 3;
        for (let r = 0; r < 6; r++) {
          const y = 200 + r * 58;
          ctx.beginPath(); ctx.moveTo(240, y); ctx.lineTo(720, y); ctx.stroke();
          for (let c = 0; c < 7; c++) {
            const x = 270 + c * 64;
            const v = (st.beads[r] || 0) > c ? 1 : 0;
            ink(ctx, v ? '#e3b45c' : '#c9b28f');
            ctx.beginPath(); ctx.arc(x, y + (v ? -10 : 12), 15, 0, 7); ctx.fill();
            ink(ctx, 'rgba(0,0,0,.35)');
            ctx.beginPath(); ctx.arc(x, y + (v ? -10 : 12), 5, 0, 7); ctx.fill();
          }
        }
        label(ctx, `当前：${window.__simValue(st)}`, 240, 540, 22, '#f0d9a8');
      },
      action(st) {
        const r = Math.floor(Math.random() * 6);
        st.beads[r] = ((st.beads[r] || 0) + 1) % 8;
        tone(1200, 0.05, 'triangle', 0.03);
      },
      extras: [{ label: '清零', fn(st) { st.beads = []; beep(2, 700); } }],
      status: '拨动珠子试试：每颗珠子是一次数位计算',
    };
  },

  payphone(st) {
    return {
      draw(ctx) {
        ink(ctx, '#1f5c3d');
        rr(ctx, 300, 130, 360, 460, 20);
        ctx.fill();
        ink(ctx, '#123a26');
        rr(ctx, 330, 160, 300, 100, 10);
        ctx.fill();
        label(ctx, st.ringing ? 'RING RING' : st.dialing ? '通话中…' : '0', 480, 212, 26, '#ffe6a8', 'center');
        ink(ctx, '#e8e2d0');
        rr(ctx, 360, 290, 240, 200, 8);
        ctx.fill();
        for (let i = 0; i < 12; i++) {
          const x = 380 + (i % 3) * 78;
          const y = 310 + Math.floor(i / 3) * 46;
          ink(ctx, '#c9c3b2');
          rr(ctx, x, y, 60, 34, 6);
          ctx.fill();
          label(ctx, String((i + 1) % 10), x + 30, y + 18, 16, '#333', 'center');
        }
        label(ctx, st.coins > 0 ? '100円' : '请投币', 480, 560, 20, '#f0d9a8', 'center');
      },
      action(st) {
        st.coins = 1; st.dialing = true;
        setTimeout(() => { st.dialing = false; st.ringing = true; setTimeout(() => { st.ringing = false; }, 1800); }, 900);
        tone(440, 0.18, 'sine', 0.03);
        setTimeout(() => tone(350, 0.25, 'sine', 0.03), 400);
        setTimeout(() => { beep(2, 900); }, 1200);
      },
      status: '投币后拨号，听拨号音与回声',
    };
  },

  fan(st) {
    return {
      draw(ctx, t) {
        ctx.save();
        ctx.translate(480, 360);
        ink(ctx, '#3c4657');
        ctx.beginPath(); ctx.arc(0, 0, 190, 0, 7); ctx.fill();
        ink(ctx, '#0d1219');
        ctx.beginPath(); ctx.arc(0, 0, 170, 0, 7); ctx.fill();
        const spin = st.on ? performance.now() * 0.012 * st.speed : 0;
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.rotate(spin + (i * Math.PI * 2) / 3);
          ink(ctx, st.on ? 'rgba(200,215,235,.5)' : 'rgba(120,130,145,.5)');
          ctx.beginPath();
          ctx.ellipse(80, 0, 78, 36, 0, 0, 7);
          ctx.fill();
          ctx.restore();
        }
        ink(ctx, '#8f9aad');
        ctx.beginPath(); ctx.arc(0, 0, 28, 0, 7); ctx.fill();
        ctx.restore();
        label(ctx, st.on ? `风速 ${st.speed}` : '停止', 480, 580, 22, '#dbe6f5', 'center');
      },
      action(st) { st.on = !st.on; if (st.on) hum(1.4); else tone(200, 0.15, 'sine', 0.03); st.speed = st.on ? 1 : 0; },
      extras: [{ label: '换挡', fn(st) { st.speed = (st.speed % 3) + 1; st.on = true; tone(160 + st.speed * 40, 0.2, 'sawtooth', 0.02); } }],
      status: '按「开风扇」，听电机与风声',
    };
  },

  crt(st) {
    return {
      draw(ctx) {
        crtScreen(ctx, 240, 150, 480, 380, st.on ? '#08160f' : '#05070b');
        if (st.on) {
          const lines = st.boot
            ? ['>> システム起動', 'CPU: i486DX 33MHz', 'MEMORY: 4096KB OK', 'C:\\> _']
            : ['C:\\> DIR', '  AUTOEXEC.BAT', '  DOS', '  DOCS', 'C:\\> _'];
          lines.forEach((l, i) => label(ctx, l, 270, 200 + i * 42, 22, '#7fffb0'));
          // 光标
          if (Math.floor(performance.now() / 500) % 2 === 0) {
            ink(ctx, '#7fffb0');
            ctx.fillRect(270, 200 + lines.length * 42 - 12, 14, 22);
          }
        }
        scanlines(ctx, 240, 150, 480, 380, 0.25);
        ctx.restore();
        // 主机 + 键盘
        ink(ctx, '#3a3f49');
        rr(ctx, 150, 560, 300, 60, 8);
        ctx.fill();
        ink(ctx, '#22262e');
        rr(ctx, 160, 570, 120, 24, 4);
        ctx.fill();
      },
      action(st) { st.on = true; st.boot = true; beep(2, 1200); setTimeout(() => { st.boot = false; }, 1600); },
      status: '按下开机键，看 CRT 自检画面',
    };
  },

  floppy(st) {
    return {
      draw(ctx, t) {
        ink(ctx, '#3b3f46');
        rr(ctx, 330, 180, 300, 210, 12);
        ctx.fill();
        ink(ctx, '#12151a');
        rr(ctx, 380, 210, 200, 40, 6);
        ctx.fill();
        label(ctx, '3.5" FDD', 480, 290, 22, '#c9d3e2', 'center');
        const insert = st.inserted ? 1 : Math.min(1, st.insertT || 0);
        const dx = 480;
        const dy = 440 - insert * 90;
        ink(ctx, '#1b1f26');
        rr(ctx, dx - 110, dy - 65, 220, 130, 8);
        ctx.fill();
        ink(ctx, '#6a7484');
        rr(ctx, dx - 80, dy - 40, 120, 70, 4);
        ctx.fill();
        ink(ctx, '#2a2f38');
        ctx.fillRect(dx - 20, dy - 65, 40, 20);
        label(ctx, st.inserted ? '读取中…' : '按「插入软盘」', 480, 620, 22, '#dbe6f5', 'center');
      },
      action(st) { st.inserted = true; st.insertT = 0; beep(2, 900); setTimeout(() => { st.insertT = 1; }, 400); },
      status: '插入软盘，听磁头读写声',
    };
  },

  fax(st) {
    return {
      draw(ctx, t) {
        ink(ctx, '#d9dde3');
        rr(ctx, 280, 220, 400, 260, 14);
        ctx.fill();
        ink(ctx, '#22262d');
        rr(ctx, 320, 260, 150, 90, 8);
        ctx.fill();
        label(ctx, st.sending ? 'SENDING' : 'READY', 395, 305, 16, '#8fffb0', 'center');
        const feed = st.sending ? Math.min(1, st.t || 0) : 0;
        ink(ctx, '#fbfaf5');
        ctx.fillRect(430, 250 + feed * 120, 190, 26);
        ctx.strokeStyle = '#bbb';
        ctx.strokeRect(430, 250 + feed * 120, 190, 26);
        label(ctx, st.sending ? '接收中…' : '按「发送传真」', 480, 560, 22, '#e8eef8', 'center');
      },
      action(st) { st.sending = true; st.t = 0; modem(); setTimeout(() => { st.sending = false; }, 2600); },
      status: '发送传真，听调制解调器的握手声',
    };
  },

  calculator(st) {
    return {
      draw(ctx) {
        ink(ctx, '#2b3038');
        rr(ctx, 330, 140, 300, 460, 18);
        ctx.fill();
        ink(ctx, '#0d1a12');
        rr(ctx, 355, 170, 250, 90, 8);
        ctx.fill();
        label(ctx, st.display || '0', 590, 215, 34, '#9fffb8', 'right');
        const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '+', '='];
        keys.forEach((k, i) => {
          const x = 355 + (i % 3) * 84;
          const y = 290 + Math.floor(i / 3) * 70;
          ink(ctx, k === '=' ? '#e3b45c' : '#454c58');
          rr(ctx, x, y, 72, 54, 6);
          ctx.fill();
          label(ctx, k, x + 36, y + 28, 22, k === '=' ? '#1a1408' : '#e8eef8', 'center');
        });
      },
      action(st) { st.display = (st.display || '0'); tone(1000, 0.04, 'square', 0.02); },
      extras: ['7', '8', '9', '4', '+', '='].map((k) => ({
        label: k,
        fn(st) {
          st.input = (st.input || '') + k;
          if (k === '=') {
            try { st.display = String(Function(`"use strict"; return (${st.input.replace(/=$/, '')})`)()); } catch (e) { st.display = 'E'; }
            st.input = '';
          } else {
            st.display = st.input;
          }
          tone(900, 0.04, 'square', 0.02);
        },
      })),
      status: '按数字和「+」「=」做一次计算',
    };
  },

  clock(st) {
    return {
      draw(ctx) {
        ctx.save();
        ctx.translate(480, 340);
        ink(ctx, '#5a3f27');
        ctx.beginPath(); ctx.arc(0, 0, 200, 0, 7); ctx.fill();
        ink(ctx, '#0e1013');
        ctx.beginPath(); ctx.arc(0, 0, 176, 0, 7); ctx.fill();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ink(ctx, '#c9d3e2');
          ctx.fillRect(Math.cos(a) * 150 - 2, Math.sin(a) * 150 - 2, 4, 14);
        }
        const now = new Date();
        const hA = ((now.getHours() % 12) + now.getMinutes() / 60) * Math.PI / 6;
        const mA = (now.getMinutes() + now.getSeconds() / 60) * Math.PI / 30;
        [hA, mA].forEach((a, i) => {
          ctx.save();
          ctx.rotate(a);
          ink(ctx, i === 0 ? '#f0d9a8' : '#c9d3e2');
          ctx.fillRect(-3, -110 + (i === 0 ? 0 : 10), 6, i === 0 ? 70 : 100);
          ctx.restore();
        });
        ink(ctx, '#e3b45c');
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();
        ctx.restore();
        label(ctx, '答答…… 时间是数码时代的第一个坐标', 480, 600, 20, '#dbe6f5', 'center');
      },
      action(st) { beep(2, 1400); },
      status: '听挂钟走时，想一想“准点”是谁规定的',
    };
  },

  vending(st) {
    return {
      draw(ctx, t) {
        ink(ctx, '#1f5f4a');
        rr(ctx, 280, 110, 400, 520, 16);
        ctx.fill();
        ink(ctx, '#0d1a16');
        rr(ctx, 310, 150, 340, 260, 10);
        ctx.fill();
        const cans = st.cans || [0, 0, 0];
        ['コーラ', 'ジュース', 'お茶'].forEach((name, i) => {
          const x = 330 + i * 105;
          ink(ctx, i === st.selected ? '#e3b45c' : '#9fb0c8');
          rr(ctx, x, 200, 90, 120, 10);
          ctx.fill();
          label(ctx, name, x + 45, 260, 14, '#1a1408', 'center');
          label(ctx, '120', x + 45, 300, 12, '#3a2b12', 'center');
        });
        ink(ctx, '#e8e2d0');
        rr(ctx, 350, 460, 240, 70, 8);
        ctx.fill();
        label(ctx, `投入：${st.coins || 0}00円`, 470, 495, 20, '#2b2110', 'center');
        if (st.dispensed) {
          ink(ctx, '#e05a3a');
          ctx.fillRect(440, 560 + Math.min(40, (st.t || 0) * 80), 60, 80);
        }
        label(ctx, st.dispensed ? '哗啦—— 拿走饮料' : '投币后选饮料', 480, 620, 20, '#e8eef8', 'center');
      },
      action(st) {
        if ((st.coins || 0) < 1) { st.coins = (st.coins || 0) + 1; tone(1400, 0.08, 'square', 0.03); return; }
        st.dispensed = true; st.t = 0;
        tone(400, 0.15, 'square', 0.04); setTimeout(() => tone(240, 0.25, 'sine', 0.03), 180);
      },
      extras: [{ label: '投币', fn(st) { st.coins = (st.coins || 0) + 1; tone(1500, 0.07, 'square', 0.03); } }],
      status: '投币 → 选饮料 → 听出货声',
    };
  },

  checkout(st) {
    return {
      draw(ctx, t) {
        ink(ctx, '#22262f');
        rr(ctx, 260, 140, 440, 380, 14);
        ctx.fill();
        ink(ctx, '#0c1210');
        rr(ctx, 300, 180, 360, 150, 8);
        ctx.fill();
        label(ctx, `合计 ¥${st.total || 0}`, 640, 230, 26, '#9fffb8', 'right');
        label(ctx, st.scanned ? '条码读取：OK' : '等待扫码…', 320, 300, 18, '#9fffb8');
        // 扫码枪光线
        if (st.scanned) {
          ink(ctx, 'rgba(226,90,58,.6)');
          ctx.fillRect(320, 340, 300, 4);
        }
        ink(ctx, '#e8e2d0');
        rr(ctx, 300, 580, 360, 70, 8);
        ctx.fill();
        label(ctx, 'P! 条码「4901234567890」', 480, 615, 18, '#2b2110', 'center');
      },
      action(st) {
        st.scanned = true; st.total = (st.total || 0) + 120;
        tone(1600, 0.06, 'square', 0.04); setTimeout(() => tone(1200, 0.06, 'square', 0.03), 90);
      },
      status: '扫一次条码，听便利店收银的「嘀」声',
    };
  },

  cooler(st) {
    return {
      draw(ctx, t) {
        ink(ctx, '#2a3644');
        rr(ctx, 300, 120, 360, 500, 14);
        ctx.fill();
        ink(ctx, '#0e151d');
        rr(ctx, 330, 150, 300, 380, 8);
        ctx.fill();
        // 冷气
        if (st.open) {
          for (let i = 0; i < 26; i++) {
            ink(ctx, `rgba(200,235,255,${0.05 + Math.random() * 0.1})`);
            ctx.beginPath();
            ctx.arc(340 + Math.random() * 280, 170 + Math.random() * 330, 10 + Math.random() * 24, 0, 7);
            ctx.fill();
          }
          label(ctx, '冷气扑面而来…', 480, 320, 24, '#cfe8ff', 'center');
        } else {
          label(ctx, '请打开冷柜', 480, 320, 22, '#cfe8ff', 'center');
        }
        // 门
        const open = st.open ? 1 : 0;
        ink(ctx, 'rgba(170,200,220,.16)');
        rr(ctx, 330 - open * 60, 150, 300, 380, 8);
        ctx.fill();
        label(ctx, st.open ? '打开：冷饮拿取' : '按「打开冷柜」', 480, 580, 20, '#dbe6f5', 'center');
      },
      action(st) { st.open = !st.open; if (st.open) hum(1.8); else tone(160, 0.2, 'sine', 0.02); },
      status: '打开冷柜门，听压缩机与冷气',
    };
  },

  entrance(st) {
    return {
      draw(ctx, t) {
        ink(ctx, '#1a2230');
        ctx.fillRect(120, 140, 720, 420);
        const open = st.open ? Math.min(1, st.t || 0) : 0;
        const shift = open * 150;
        ink(ctx, '#c8d4e6');
        ctx.fillRect(300 - shift, 180, 170, 340);
        ctx.fillRect(490 + shift, 180, 170, 340);
        ink(ctx, '#0c1218');
        ctx.fillRect(470 - shift + 170, 180, 20, 340);
        ctx.fillRect(470 + shift, 180, 20, 340);
        if (st.open) {
          ink(ctx, 'rgba(180,220,255,.14)');
          ctx.fillRect(470 - open * 150, 180, 300, 340);
        }
        label(ctx, st.open ? '🟢 感应开门（人通过）' : '按「走近自动门」', 480, 620, 20, '#dbe6f5', 'center');
        ink(ctx, '#e3b45c');
        ctx.beginPath(); ctx.arc(480, 600, 5, 0, 7); ctx.fill();
      },
      action(st) { st.open = true; st.t = 0; tone(900, 0.1, 'sine', 0.03); setTimeout(() => { hum(0.8); }, 300); },
      status: '走近门口，看感应器如何“看见”你',
    };
  },

  lighthouse(st) {
    return {
      draw(ctx, t) {
        // 天空 + 海
        ink(ctx, '#0b1426');
        ctx.fillRect(120, 120, 720, 300);
        ink(ctx, '#0f2436');
        ctx.fillRect(120, 420, 720, 180);
        // 塔
        ctx.save();
        ctx.translate(480, 430);
        ink(ctx, '#d8d2c2');
        ctx.beginPath();
        ctx.moveTo(-70, 0); ctx.lineTo(-40, -300); ctx.lineTo(40, -300); ctx.lineTo(70, 0); ctx.closePath();
        ctx.fill();
        ink(ctx, '#b03a3a');
        ctx.fillRect(-34, -180, 68, 40);
        ink(ctx, '#1a1408');
        ctx.fillRect(-30, -260, 60, 26);
        // 光束
        if (st.lit) {
          const ang = performance.now() * 0.0012;
          const len = 600;
          ctx.save();
          ctx.globalAlpha = 0.22;
          ctx.rotate(Math.sin(ang) * 0.5);
          const grad = ctx.createLinearGradient(0, -260, len, -260);
          grad.addColorStop(0, 'rgba(255,235,180,.9)');
          grad.addColorStop(1, 'rgba(255,235,180,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(0, -262);
          ctx.lineTo(len, -340);
          ctx.lineTo(len, -180);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        label(ctx, st.lit ? '光束每 12 秒旋转一周' : '按「点亮灯塔」', 480, 640, 20, '#dbe6f5', 'center');
      },
      action(st) { st.lit = true; tone(220, 1.2, 'sine', 0.03); setTimeout(() => tone(330, 0.8, 'sine', 0.02), 600); },
      status: '点亮灯塔，看光束扫过海面',
    };
  },
};

function simValue(st) {
  return (st.beads || []).reduce((a, b) => a + b, 0);
}
window.__simValue = simValue;

/* ---------------- 运行器 ---------------- */
let current = null;

export function openSimulator(ex, opts = {}) {
  const type = ex.sim || ex.id;
  const make = TYPES[type] || TYPES.tv;
  const st = { on: false, channel: 1, speed: 0, beads: [], coins: 0, total: 0, display: '0' };
  const sim = make(st);
  current = { ex, sim, st };

  $('sim-title').textContent = `使用模拟 · ${ex.name}`;
  $('sim-sub').textContent = `${ex.year} · 当年价格 ${ex.price}`;
  $('sim-status').textContent = sim.status || '点击下方按钮，试着用一下这台设备';
  const canvas = $('sim-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.aspectRatio = '4 / 3';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const actionBtn = $('sim-action');
  actionBtn.textContent = ex.use_label || '使用一下';
  actionBtn.onclick = () => {
    try { sim.action(st); } catch (e) { console.warn(e); }
    $('sim-status').textContent = `正在模拟：${ex.use_label || '使用'} · ${ex.name}`;
  };
  const extra = $('sim-extra');
  extra.innerHTML = '';
  (sim.extras || []).forEach((c) => {
    const b = document.createElement('button');
    b.className = 'ghost-btn small';
    b.textContent = c.label;
    b.onclick = () => { try { c.fn(st); } catch (e) {} };
    extra.appendChild(b);
  });

  // 背景
  function frame() {
    if (!current || current.ex.id !== ex.id) return;
    ctx.clearRect(0, 0, W, H);
    // 展厅背景
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1220');
    g.addColorStop(1, '#05080d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ink(ctx, 'rgba(227,180,92,.10)');
    ctx.fillRect(0, H - 130, W, 130);
    label(ctx, opts.eraLabel || '', 40, 44, 18, 'rgba(227,180,92,.7)');
    label(ctx, '数码考古馆 · 使用模拟', 40, 70, 14, 'rgba(200,214,232,.45)');
    try { sim.draw(ctx, performance.now() / 1000); } catch (e) { console.warn(e); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  $('modal-sim').classList.remove('hidden');
  return true;
}

export function closeSimulator() {
  current = null;
  $('modal-sim').classList.add('hidden');
}

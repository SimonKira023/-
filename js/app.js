// 数码考古馆 · 360° 实景版主程序
// 场景为 Godot 原始场景渲染出的全景图（保留游戏原始光影），Agent 通过「转头 + 变焦」带路。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAgent } from './agent.js';
import { openSimulator, closeSimulator } from './simulator.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const CONFIG = window.MUSEUM_CONFIG || {};

const state = {
  data: null,
  agent: null,
  era: null,
  view: { yaw: 0, pitch: 0, fov: 72 },       // 当前视角（相对全景中心）
  target: { yaw: 0, pitch: 0, fov: 72 },     // 目标视角（动画）
  anim: null,
  texture: null,
  selectedId: null,
  hotspots: [],
  routeToken: 0,
  voice: false,
  history: [],
  ready: false,
  dragging: false,
  lastPointer: null,
  memory: { visited: [], questions: [], startedAt: Date.now(), lastVisit: 0 },
  tour: null,
  mode: 'pano',
  view3d: false,
  glb: null,
  three: { speed: 4, range: 12, size: 10 },
  free: { keys: new Set(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), moving: 0 },
  cam: {
    active: false,
    zoom: 72,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    keys: new Set(),
    shots: [],
    walking: 0,
    expert: false,
    params: { exposure: 1.0, grain: 0.085, warm: 0.13, saturation: 1.0, smear: 0, focusBlur: 0, vignette: 0.62 },
    expertParams: { focal: 35, fstop: 4, shutter: 60, iso: 400, wb: 5600, ev: 0, tele: 1, nd: 0, polarizer: false },
  },
};

/* ---------------- 参观记忆（持久化） ---------------- */
const MEMORY_KEY = 'museum-memory-v2';
function loadMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m || !Array.isArray(m.visited)) return null;
    m.startedAt = m.startedAt || Date.now();
    return m;
  } catch (e) { return null; }
}
function saveMemory() {
  try {
    state.memory.lastVisit = Date.now();
    localStorage.setItem(MEMORY_KEY, JSON.stringify(state.memory));
  } catch (e) {}
}
function recordVisit(ex) {
  if (!ex) return;
  const last = state.memory.visited[state.memory.visited.length - 1];
  if (last && last.id === ex.id) return;
  state.memory.visited.push({ id: ex.id, name: ex.name, scene: ex.scene, ts: Date.now() });
  if (state.memory.visited.length > 60) state.memory.visited.splice(0, state.memory.visited.length - 60);
  saveMemory();
}

/* ---------------- three.js ---------------- */
const container = $('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(state.view.fov, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 0, 0);

const uniforms = {
  map: { value: null },
  fwd: { value: new THREE.Vector3(0, 0, -1) },
  rightU: { value: new THREE.Vector3(1, 0, 0) },
  upU: { value: new THREE.Vector3(0, 1, 0) },
};

const pano = new THREE.Mesh(
  new THREE.SphereGeometry(120, 96, 48),
  new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 fwd;
      uniform vec3 rightU;
      uniform vec3 upU;
      varying vec3 vDir;
      #define PI 3.141592653589793
      void main() {
        vec3 d = normalize(vDir);
        float yaw = atan(dot(d, rightU), dot(d, fwd));
        float pitch = asin(clamp(dot(d, upU), -1.0, 1.0));
        vec2 uv = vec2(yaw / (2.0 * PI) + 0.5, 0.5 - pitch / PI);
        vec4 tex = texture2D(map, uv);
        gl_FragColor = tex;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
);
pano.renderOrder = -1;
scene.add(pano);

scene.background = new THREE.Color('#060a12');

/* ---------------- 3D 自由模式（原始 GLB 场景） ---------------- */
const MODEL_MAP = {
  shop: 'assets/models/shop1980.glb',
  office: 'assets/models/office1994.glb',
  mart: 'assets/models/mart1987.glb',
};
const gltfLoader = new GLTFLoader();
function clearModel3D() {
  if (state.glb) {
    scene.remove(state.glb);
    state.glb.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m && m.map) m.map.dispose(); if (m) m.dispose(); });
      }
    });
    state.glb = null;
  }
}
function is3D() { return state.mode === '3d'; }
function loadModel3D(era) {
  return new Promise((resolve) => {
    clearModel3D();
    setLoading(true, `正在加载 3D 场景…`, '原始 GLB 模型，可自由飞行', 0.1);
    const url = MODEL_MAP[era];
    if (!url) { setLoading(false); console.warn('[3D] no model for era', era); resolve(); return; }
    gltfLoader.load(url, (gltf) => {
      state.glb = gltf.scene;
      scene.add(state.glb);
      pano.visible = false;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const diag = Math.max(1, size.length());
      state.three.size = diag;
      state.three.speed = Math.max(1.2, diag * 0.22);
      state.three.range = Math.max(6, diag * 1.2);
      state.free.pos.copy(center.clone().add(new THREE.Vector3(size.x * 0.1, size.y * 0.18, size.z * 0.9)));
      state.free.vel.set(0, 0, 0);
      const dir = center.clone().sub(state.free.pos).normalize();
      state.view.yaw = THREE.MathUtils.radToDeg(Math.atan2(dir.x, -dir.z));
      state.view.pitch = THREE.MathUtils.radToDeg(Math.asin(clamp(dir.y, -1, 1)));
      state.view.fov = 65;
      // 模型自带灯光（KHR_lights_punctual）或补一盏环境光
      let lights = 0;
      gltf.scene.traverse((o) => { if (o.isLight) lights++; });
      if (!lights) {
        const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x30271f, 1.0);
        hemi.name = '__lead_hemi';
        scene.add(hemi);
      }
      state.glb.userData.lights = lights;
      setLoading(false);
      toast(`3D 自由模式 · ${eraMeta(era).label}`);
      resolve();
    }, (evt) => {
      if (evt && evt.total) $('loading-bar').style.width = `${Math.round(clamp(evt.loaded / evt.total, 0, 0.95) * 100)}%`;
    }, (err) => {
      console.error(err);
      setLoading(true, '3D 模型加载失败', '请确认 assets/models 下的 GLB 存在。', 1);
      resolve();
    });
  });
}
function applyCamera3D() {
  const y = state.view.yaw * Math.PI / 180;
  const p = state.view.pitch * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  camera.position.copy(state.free.pos);
  camera.lookAt(state.free.pos.clone().add(dir));
  if (Math.abs(camera.fov - state.view.fov) > 0.01) {
    camera.fov = state.view.fov;
    camera.updateProjectionMatrix();
  }
}
function movementBasis() {
  let forward;
  let up;
  if (is3D()) {
    const y = state.view.yaw * Math.PI / 180;
    forward = new THREE.Vector3(Math.sin(y), 0, -Math.cos(y));
    up = new THREE.Vector3(0, 1, 0);
  } else {
    forward = dirFromYawPitch(state.view.yaw, 0);
    up = new THREE.Vector3().fromArray(eraMeta().up);
  }
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  return { forward, right, up };
}

/* ---------------- 老式摄像机后处理（VHS / Video8 质感） ---------------- */
const camRT = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
const camQuadScene = new THREE.Scene();
const camQuadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const camUniforms = {
  tDiffuse: { value: camRT.texture },
  time: { value: 0 },
  resolution: { value: new THREE.Vector2(2, 2) },
  exposure: { value: 1.0 },
  grain: { value: 0.085 },
  vignette: { value: 0.62 },
  chroma: { value: 0.0016 },
  scan: { value: 0.22 },
  warm: { value: 0.13 },
  distort: { value: 0.16 },
  saturation: { value: 1.0 },
  smear: { value: 0.0 },
  focusBlur: { value: 0.0 },
};
camQuadScene.add(new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: camUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float time;
      uniform vec2 resolution;
      uniform float exposure;
      uniform float grain;
      uniform float vignette;
      uniform float chroma;
      uniform float scan;
      uniform float warm;
      uniform float distort;
      uniform float saturation;
      uniform float smear;
      uniform float focusBlur;
      varying vec2 vUv;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      vec3 sampleSoft(vec2 uv, vec2 px) {
        vec2 o = px * (1.0 + focusBlur * 5.0);
        vec3 c = texture2D(tDiffuse, uv).rgb * 0.5;
        c += texture2D(tDiffuse, uv + vec2(o.x * 1.2, 0.0)).rgb * 0.18;
        c += texture2D(tDiffuse, uv - vec2(o.x * 1.2, 0.0)).rgb * 0.18;
        c += texture2D(tDiffuse, uv + vec2(0.0, o.y * 1.2)).rgb * 0.07;
        c += texture2D(tDiffuse, uv - vec2(0.0, o.y * 1.2)).rgb * 0.07;
        return c;
      }

      void main() {
        vec2 px = 1.0 / resolution;
        vec2 cc = vUv - 0.5;
        float r2 = dot(cc, cc);
        // 桶形畸变（老镜头）
        vec2 uv = 0.5 + cc * (1.0 + distort * r2);
        // 低带宽 + 轻微模糊
        vec3 col = sampleSoft(uv, px);
        // 快门拖尾（慢门横向拖影）
        if (smear > 0.001) {
          vec3 trail = texture2D(tDiffuse, uv - vec2(smear, 0.012)).rgb;
          col = mix(col, trail, 0.35);
        }
        // 色差（VHS 色度分离）
        vec3 ca;
        ca.r = texture2D(tDiffuse, uv + vec2(chroma * 2.2, 0.0)).r;
        ca.g = col.g;
        ca.b = texture2D(tDiffuse, uv - vec2(chroma * 2.2, 0.0)).b;
        col = mix(col, ca, 0.85);
        // 行抖动 / 磁带抖动
        float lineJitter = step(0.996, hash(vec2(floor(uv.y * resolution.y * 0.5), floor(time * 2.0))));
        col.r += lineJitter * 0.03;
        // 暖色调 + 降饱和（老磁带）
        col = col * vec3(1.0 + warm, 1.0, 1.0 - warm * 0.55);
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(lum), col, clamp(saturation, 0.0, 1.6));
        // 扫描线
        float sl = sin(uv.y * resolution.y * 1.45 + time * 3.0);
        col *= 1.0 - scan * 0.10 - scan * 0.08 * sl;
        // 颗粒
        float n = hash(uv * resolution + fract(time) * 217.0);
        col += (n - 0.5) * grain;
        // 曝光闪烁
        col *= 1.0 + 0.018 * sin(time * 41.0);
        col *= exposure;
        // 暗角
        float v = smoothstep(1.0, 0.15, r2 * 1.7);
        col *= mix(1.0 - vignette, 1.0, v);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  })
));


const loader = new THREE.TextureLoader();
const hotspotLayer = $('hotspot-layer');

/* ---------------- helpers ---------------- */
const D2R = Math.PI / 180;
function eraMeta(era = state.era) {
  return state.data.meta.eras[era];
}
function dirFromYawPitch(yawDeg, pitchDeg, era = state.era) {
  const m = eraMeta(era);
  const f = new THREE.Vector3().fromArray(m.forward);
  const r = new THREE.Vector3().fromArray(m.right);
  const u = new THREE.Vector3().fromArray(m.up);
  const y = yawDeg * D2R;
  const p = pitchDeg * D2R;
  return f.multiplyScalar(Math.cos(p) * Math.cos(y))
    .add(r.multiplyScalar(Math.cos(p) * Math.sin(y)))
    .add(u.multiplyScalar(Math.sin(p)))
    .normalize();
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function applyCamera() {
  const dir = dirFromYawPitch(state.view.yaw, state.view.pitch);
  const m = eraMeta();
  camera.up.set(m.up[0], m.up[1], m.up[2]);
  // 关键：视点移动后，看向的是“当前位置 + 视线方向”，而不是世界原点
  camera.lookAt(camera.position.clone().add(dir));
  if (Math.abs(camera.fov - state.view.fov) > 0.01) {
    camera.fov = state.view.fov;
    camera.updateProjectionMatrix();
  }
}

/* ---------------- Godot Web 3D 漫游（默认主视图） ---------------- */
function godotURL(scene) {
  return `godot/index.html?scene=${scene}`;
}
function isView3D() { return !!state.view3d; }

function setView3D(on, scene) {
  state.view3d = !!on;
  document.body.classList.toggle('view-3d', state.view3d);
  const frame = $('godot-base');
  if (state.view3d) {
    const sid = ['shop', 'office', 'mart'].includes(scene) ? scene : state.era;
    state.era = sid;
    if (frame && !frame.src.includes(`scene=${sid}`)) frame.src = godotURL(sid);
    buildMarkers3D();
    if (state.cam.active) layoutCamcorder();
  } else {
    if (frame) frame.src = 'about:blank';
    hotspotLayer.style.display = '';
    clearMarkers3D();
    buildHotspots();
    loadEra(state.era, { force: true, silent: true });
  }
  updateModeButton();
  updateCamLabels();
}
function openGodot(scene) { setView3D(true, scene); }
function closeGodot() { setView3D(false); }

/* ---- 3D 展品标记（把 pos3d 投影到屏幕） ---- */
const V3 = { cam: null, markers: [] };
function clearMarkers3D() {
  V3.markers.forEach((m) => m.el.remove());
  V3.markers = [];
}
function buildMarkers3D() {
  clearMarkers3D();
  if (!state.view3d || !state.data) return;
  const layer = $('hotspot-layer');
  const exs = (state.data.exhibits || []).filter((e) => e.scene === state.era && e.pos3d);
  exs.forEach((ex) => {
    const el = document.createElement('button');
    el.className = 'hotspot-3d';
    el.innerHTML = `<i>${ex.name.slice(0, 1)}</i><span>${ex.name}</span>`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectExhibit(ex.id, { fly: false, openCard: true });
    });
    layer.appendChild(el);
    V3.markers.push({ el, pos: ex.pos3d });
  });
  updateMarkers3D();
}
function updateMarkers3D() {
  if (!state.view3d || !V3.cam || !V3.markers.length) return;
  const c = V3.cam;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const aspect = W / Math.max(1, H);
  const f = 1 / Math.tan((c.fov * Math.PI) / 360);
  V3.markers.forEach(({ el, pos }) => {
    const dx = pos[0] - c.p[0];
    const dy = pos[1] - c.p[1];
    const dz = pos[2] - c.p[2];
    const x = dx * c.x[0] + dy * c.x[1] + dz * c.x[2];
    const y = dx * c.y[0] + dy * c.y[1] + dz * c.y[2];
    const z = -(dx * c.z[0] + dy * c.z[1] + dz * c.z[2]);
    if (z <= 0.25) { el.style.display = 'none'; return; }
    const sx = (x / (z * f * aspect)) * 0.5 + 0.5;
    const sy = 0.5 - (y / (z * f)) * 0.5;
    if (sx < -0.08 || sx > 1.08 || sy < -0.08 || sy > 1.08) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.left = `${(sx * W).toFixed(1)}px`;
    el.style.top = `${(sy * H).toFixed(1)}px`;
    el.style.opacity = clamp(1.35 - z / 28, 0.4, 1).toFixed(2);
  });
}
window.__museum3dCamera = (arr) => {
  if (!arr || arr.length < 13) return;
  V3.cam = {
    p: arr.slice(0, 3), x: arr.slice(3, 6), y: arr.slice(6, 9), z: arr.slice(9, 12), fov: arr[12],
  };
  updateMarkers3D();
};
window.__museum3dReady = (sid) => {
  if (!state.view3d || sid !== state.era) return;
  buildMarkers3D();
  const pending = window.__pendingFocus3D;
  if (pending && window.__pendingFocusEra === sid) {
    window.__pendingFocus3D = null;
    window.__pendingFocusEra = null;
    const frame = $('godot-base');
    const win = frame && frame.contentWindow;
    if (win && typeof win.museumFocus === 'function') {
      try { win.museumFocus(pending[0], pending[1], pending[2]); } catch (e) {}
    }
  }
};
window.__museum3dShot = (dataUrl) => apply3DPhoto(dataUrl);
window.__museum3dLog = (m) => { (window.__museum3dLogs || (window.__museum3dLogs = [])).push(String(m)); };

function focus3D(ex) {
  if (!ex || !ex.pos3d) return;
  const frame = $('godot-base');
  const win = frame && frame.contentWindow;
  if (win && typeof win.museumFocus === 'function') {
    try { win.museumFocus(ex.pos3d[0], ex.pos3d[1], ex.pos3d[2]); } catch (e) {}
  }
}

function capture3DPhoto() {
  const frame = $('godot-base');
  const win = frame && frame.contentWindow;
  if (win && typeof win.museumCapture === 'function') {
    flashShutter();
    toast('正在冲洗照片…');
    try { win.museumCapture(); } catch (e) { toast('3D 拍照失败'); }
  } else {
    toast('3D 场景还没准备好，稍等一秒再拍');
  }
}

function apply3DPhoto(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const W = 1440;
    const H = 1080;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    // 从 16:9 截图中裁 4:3，再套 VHS 质感
    const sw = img.width;
    const sh = (img.width * 3) / 4;
    const sy0 = Math.max(0, (img.height - sh) / 2);
    ctx.filter = 'saturate(0.85) contrast(1.07) sepia(0.16) brightness(0.97)';
    ctx.drawImage(img, 0, sy0, sw, sh, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    drawCamOverlay(ctx, W, H);
    const idx = state.cam.shots.length + 1;
    const date = (eraMeta().date || '1987.08.12').replace(/\./g, '-');
    const ts = new Date();
    const hhmm = `${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
    const name = `数码考古馆_${date}_${hhmm}_${String(idx).padStart(2, '0')}.png`;
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      addCamThumb(url, name);
      state.cam.shots.push({ url, name, era: state.era, ts: Date.now() });
      state.memory.photos = (state.memory.photos || 0) + 1;
      saveMemory();
      setTimeout(() => { if (!state.cam.shots.find((x) => x.url === url && x.name === name)) URL.revokeObjectURL(url); }, 60000);
    }, 'image/png');
    toast(`已拍照 · 胶卷 ${idx} 张`);
  };
  img.src = dataUrl;
}

/* ---------------- 老式摄像机模式 ---------------- */
function layoutCamcorder() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ar = 4 / 3;
  let w = vw * 0.92;
  let h = w / ar;
  if (h > vh * 0.94) { h = vh * 0.94; w = h * ar; }
  renderer.setSize(Math.round(w), Math.round(h), false);
  const c = renderer.domElement;
  c.style.width = `${Math.round(w)}px`;
  c.style.height = `${Math.round(h)}px`;
  camera.aspect = ar;
  camera.updateProjectionMatrix();
  camRT.setSize(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)));
  camUniforms.resolution.value.set(Math.round(w), Math.round(h));
  const frame = $('cam-frame');
  if (frame) {
    frame.style.width = `${Math.round(w)}px`;
    frame.style.height = `${Math.round(h)}px`;
  }
}

function layoutNormal() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const c = renderer.domElement;
  c.style.width = `${window.innerWidth}px`;
  c.style.height = `${window.innerHeight}px`;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (state.cam.active) layoutCamcorder();
}

function updateCamLabels() {
  const m = eraMeta();
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('cam-date', m.date || '1987.08.12');
  set('cam-model', m.camcorder || 'Video8');
  set('cam-era', m.label);
}

function applyCamParams() {
  camUniforms.exposure.value = state.cam.params.exposure;
  camUniforms.grain.value = state.cam.params.grain;
  camUniforms.warm.value = state.cam.params.warm;
  const map = { 'cam-exposure': 'exposure', 'cam-grain': 'grain', 'cam-warm': 'warm' };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.value = String(state.cam.params[key]);
    const v = document.getElementById(`${id}-val`);
    if (v) v.textContent = state.cam.params[key].toFixed(2);
  });
}

/* ---------------- 自由视角移动（默认模式，WASD / 方向键） ---------------- */
const FREE_RANGE = 6.0;
const FLY = {
  freeSpeed: 18, freeBoost: 46, camSpeed: 14, camBoost: 36,
  freeRange: 14, camRange: 12, accel: 11,
};
function flyTarget(keys, speed) {
  const basis = movementBasis();
  const forward = basis.forward;
  const upV = basis.up;
  const rightV = basis.right;
  const move = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) move.add(forward);
  if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
  if (keys.has('d') || keys.has('arrowright')) move.add(rightV);
  if (keys.has('a') || keys.has('arrowleft')) move.sub(rightV);
  if (keys.has('q')) move.sub(upV);
  if (keys.has('e')) move.add(upV);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
  return move;
}
function updateFreeMove(dt) {
  if (state.cam.active) return;
  const keys = state.free.keys;
  const base = is3D() ? state.three.speed : FLY.freeSpeed;
  const speed = keys.has('shift') ? base * (is3D() ? 3.2 : 2.6) : base;
  const target = flyTarget(keys, speed);
  state.free.vel.lerp(target, Math.min(1, FLY.accel * dt));
  state.free.pos.addScaledVector(state.free.vel, dt);
  const range = is3D() ? state.three.range : FLY.freeRange;
  if (state.free.pos.length() > range) {
    // 3D 模式允许围绕场景中心活动，超过范围时拉回
    state.free.pos.setLength(range);
    state.free.vel.multiplyScalar(0.35);
  }
  state.free.moving = clamp(state.free.vel.length() / Math.max(1, base), 0, 1);
}

/* ---------------- 专家模式：真实相机参数 → 画面 ---------------- */
function lensFov(focal) {
  // 36mm 全画幅等效：水平视角 = 2 * atan(18 / f)
  return THREE.MathUtils.radToDeg(2 * Math.atan(18 / focal));
}
function applyExpertParams() {
  const p = state.cam.expertParams;
  const c = state.cam.params;
  const tele = p.tele || 1;
  const effFocal = (p.focal || 35) * tele;
  const opticalFov = lensFov(effFocal);
  // 数码变焦：超出光学焦距后只是裁切放大，画质会掉
  state.view.fov = clamp(Math.round(opticalFov), 6, 72);
  const ndFactor = Math.pow(2, p.nd || 0);
  const effFstop = (p.fstop || 4) * tele;
  c.exposure = clamp(
    (Math.pow(2, p.ev) * Math.sqrt(p.iso / 400) * Math.sqrt(60 / Math.max(8, p.shutter))) / ndFactor * (p.polarizer ? 0.9 : 1),
    0.2, 2.4
  );
  c.grain = clamp(0.02 + (p.iso / 6400) * 0.9, 0.02, 0.26);
  c.warm = clamp((5600 - p.wb) / 6000, -0.18, 0.34);
  c.vignette = clamp(0.28 + (5.6 - effFstop) * 0.04 + (tele > 1.5 ? 0.08 : 0), 0.2, 0.85);
  c.smear = p.shutter < 40 ? clamp((60 / p.shutter - 1) * 0.006, 0, 0.045) : 0;
  // 长焦 + 增距镜会引入轻微锐度下降（老玻璃）
  c.focusBlur = clamp((p.focus || 0) / 100 * 0.6 + (tele - 1) * 0.06, 0, 0.7);
  c.saturation = clamp((p.saturation ?? 1.0) * (p.polarizer ? 1.12 : 1), 0.2, 1.6);
  camUniforms.saturation.value = c.saturation;
  camUniforms.smear.value = c.smear;
  camUniforms.focusBlur.value = c.focusBlur;
  camUniforms.vignette.value = c.vignette;
  applyCamParams();
  syncExpertUI();
  const ro = $('lens-readout');
  if (ro) {
    const f = Math.round(effFocal);
    const glass = tele > 1 ? ` + ${tele}× 增距镜` : '';
    ro.innerHTML = `等效 <b>${f}mm</b>${glass} · f/${effFstop.toFixed(1)} · 1/${p.shutter}s · ISO ${p.iso}<br><span class="muted">${p.nd ? `ND${p.nd * 3} ` : ''}${p.polarizer ? '偏振镜 ' : ''}物理玻璃${tele > 1 ? '（更重、更贵，但更清楚）' : ''}</span>`;
  }
  updateCamAdvice();
}
function syncExpertUI() {
  const p = state.cam.expertParams;
  const map = {
    'exp-focal': [p.focal, `${Math.round(p.focal)}mm`],
    'exp-fstop': [p.fstop, `f/${p.fstop}`],
    'exp-shutter': [p.shutter, `1/${p.shutter}s`],
    'exp-iso': [p.iso, String(p.iso)],
    'exp-wb': [p.wb, `${p.wb}K`],
    'exp-ev': [p.ev, `${p.ev > 0 ? '+' : ''}${p.ev.toFixed(1)}EV`],
    'exp-sat': [p.saturation ?? 1, `${Math.round((p.saturation ?? 1) * 100)}%`],
    'exp-focus': [p.focus || 0, `${Math.round(p.focus || 0)}`],
  };
  Object.entries(map).forEach(([id, [val, text]]) => {
    const el = document.getElementById(id);
    if (el) el.value = String(val);
    const v = document.getElementById(`${id}-val`);
    if (v) v.textContent = text;
  });
}
function setExpertMode(on) {
  state.cam.expert = !!on;
  const simple = $('cam-panel-simple');
  const expert = $('cam-panel-expert');
  if (simple) simple.classList.toggle('hidden', state.cam.expert);
  if (expert) expert.classList.toggle('hidden', !state.cam.expert);
  if (state.cam.expert) applyExpertParams();
  else applyCamParams();
}
function updateCamAdvice() {
  const p = state.cam.expertParams;
  const notes = [];
  if (p.ev > 0.8) notes.push('曝光补偿偏高，画面可能过曝');
  if (p.ev < -0.8) notes.push('曝光补偿偏低，暗部会糊成一片');
  if (p.iso >= 1600) notes.push('ISO 较高：颗粒明显（符合 1980s 磁带感，但细节会丢）');
  if (p.shutter < 30) notes.push('快门慢于 1/30s：手持会拖影');
  if (p.fstop <= 2) notes.push('大光圈：暗角与边缘色差更明显');
  if (!notes.length) notes.push('参数处于正常工作范围');
  const warn = $('exp-warn');
  if (warn) warn.textContent = notes.join('；');
  const eraTip = eraMeta().year === 1987 ? '1987 年家用录像：低对比、偏暖、颗粒中等' : eraMeta().year === 1994 ? '1994 年 Hi8：画质更好，颜色更干净' : '1980 年 VHS：低分辨率、扫描线与色差明显';
  const tip = $('cam-ai-text');
  if (tip && !tip.dataset.locked) {
    tip.textContent = `当前 ${eraTip}。想拍更远：优先换长焦或加增距镜（物理玻璃，清楚但更重更贵）；数码变焦只是裁切，越远越糊。`;
  }
}
function applyCameraStyle(a) {
  if (!state.cam.active) enterCamcorder();
  setExpertMode(true);
  Object.assign(state.cam.expertParams, a.params || {});
  applyExpertParams();
  const tip = $('cam-ai-text');
  if (tip) {
    delete tip.dataset.locked;
    tip.textContent = `已套用「${a.label || '自定义风格'}」：${Object.entries(a.params || {}).map(([k, v]) => `${k}=${v}`).join('，')}`;
  }
  toast(`已套用风格：${a.label || '自定义'}`);
}

async function askCameraAI(text) {
  const v = String(text || '').trim();
  if (!v) return;
  const tip = $('cam-ai-text');
  if (tip) { tip.dataset.locked = '1'; tip.textContent = '小奖正在按你的描述调参数…'; }
  try {
    const res = await state.agent.respond(v, { era: state.era, selectedId: state.selectedId, history: state.history, memory: state.memory });
    if (tip) tip.textContent = String(res.reply).replace(/\*\*(.+?)\*\*/g, '$1');
    await execActions(res.actions || [], null);
  } catch (e) {
    if (tip) tip.textContent = '调参失败，请再试一次。';
  }
  setTimeout(() => { if (tip) delete tip.dataset.locked; updateCamAdvice(); }, 4000);
}

function enterCamcorder() {
  if (!state.ready || state.cam.active) return;
  state.cam.active = true;
  state.cam.pos.set(0, 0, 0);
  state.cam.keys.clear();
  state.cam.zoom = state.view.fov;
  $('camcorder').classList.remove('hidden');
  document.body.classList.add('camcorder-mode');
  layoutCamcorder();
  updateCamLabels();
  if (state.cam.expert) applyExpertParams(); else applyCamParams();
  updateCamAdvice();
  toast('摄像机已开启：拖动看四周 · WASD/方向键移动 · 滚轮变焦 · 空格拍照 · Esc 退出');
}

function exitCamcorder() {
  if (!state.cam.active) return;
  state.cam.active = false;
  state.cam.keys.clear();
  camera.position.set(0, 0, 0);
  $('camcorder').classList.add('hidden');
  document.body.classList.remove('camcorder-mode');
  layoutNormal();
  applyCamera();
  toast('已退出摄像机模式');
}

function updateCamMovement(dt) {
  if (!state.cam.active) return;
  const keys = state.cam.keys;
  const baseCam = is3D() ? state.three.speed : FLY.camSpeed;
  const speed = keys.has('shift') ? baseCam * 2.8 : baseCam;
  const target = flyTarget(keys, speed);
  state.cam.vel.lerp(target, Math.min(1, FLY.accel * dt));
  state.cam.pos.addScaledVector(state.cam.vel, dt);
  const camRange = is3D() ? state.three.range : FLY.camRange;
  if (state.cam.pos.length() > camRange) {
    state.cam.pos.setLength(camRange);
    state.cam.vel.multiplyScalar(0.35);
  }
  state.cam.walking = clamp(state.cam.vel.length() / Math.max(1, baseCam), 0, 1);
}

function applyCamSway(t) {
  const amp = 0.35 + state.cam.walking * 0.85;
  camera.rotateY(THREE.MathUtils.degToRad((Math.sin(t * 1.31) * 0.30 + Math.sin(t * 2.87) * 0.10) * amp));
  camera.rotateX(THREE.MathUtils.degToRad(Math.sin(t * 1.73 + 2.0) * 0.16 * amp));
  camera.rotateZ(THREE.MathUtils.degToRad(Math.sin(t * 0.87) * 0.55 * amp));
  camera.position.copy(state.cam.pos);
  camera.position.y += Math.sin(t * 2.2) * 0.005 * amp;
}

function flashShutter() {
  const f = $('cam-flash');
  if (!f) return;
  f.classList.remove('show');
  void f.offsetWidth;
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 320);
}

function capturePhoto() {
  if (!state.cam.active) return;
  if (state.view3d) { capture3DPhoto(); return; }
  camUniforms.time.value = performance.now() / 1000;
  renderer.setRenderTarget(camRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(camQuadScene, camQuadCam);
  const src = renderer.domElement;
  const W = 1440;
  const H = 1080;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, W, H);
  drawCamOverlay(ctx, W, H);
  const idx = state.cam.shots.length + 1;
  const date = (eraMeta().date || '1987.08.12').replace(/\./g, '-');
  const ts = new Date();
  const hhmm = `${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
  const name = `数码考古馆_${date}_${hhmm}_${String(idx).padStart(2, '0')}.png`;
  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    addCamThumb(url, name);
    state.cam.shots.push({ url, name, era: state.era, ts: Date.now() });
    state.memory.photos = (state.memory.photos || 0) + 1;
    saveMemory();
    setTimeout(() => { if (!state.cam.shots.find((s) => s.url === url && s.name === name)) URL.revokeObjectURL(url); }, 60000);
  }, 'image/png');
  flashShutter();
  toast(`已拍照 · 胶卷 ${idx} 张`);
}

function addCamThumb(url, name) {
  const strip = $('cam-shots');
  if (!strip) return;
  strip.classList.remove('hidden');
  const el = document.createElement('a');
  el.className = 'cam-thumb';
  el.href = url;
  el.target = '_blank';
  el.title = name;
  const img = document.createElement('img');
  img.src = url;
  img.alt = name;
  el.appendChild(img);
  strip.appendChild(el);
  strip.scrollLeft = strip.scrollWidth;
}

function drawCamOverlay(ctx, W, H) {
  const S = W / 1440;
  const pad = Math.round(38 * S);
  ctx.save();
  ctx.textBaseline = 'middle';
  const font = (px) => `${Math.round(px * S)}px "Courier New", Consolas, monospace`;
  const shadow = () => { ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = Math.round(6 * S); ctx.shadowOffsetY = Math.round(2 * S); };
  const white = 'rgba(245,245,240,.92)';

  // 取景框四角
  shadow();
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = Math.max(2, Math.round(3 * S));
  const L = Math.round(64 * S);
  [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * L);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * L, y);
    ctx.stroke();
  });

  // REC
  ctx.fillStyle = 'rgba(230,40,40,.95)';
  ctx.beginPath();
  ctx.arc(pad + 12 * S, pad + 12 * S, 7 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `bold ${font(34 * S)}`;
  ctx.fillStyle = white;
  ctx.fillText('REC', pad + 30 * S, pad + 13 * S);
  ctx.font = font(24 * S);
  ctx.fillStyle = 'rgba(230,230,225,.8)';
  ctx.fillText('SP', pad, pad + 52 * S);

  // 电池
  const bw = 54 * S, bh = 24 * S, bx = W - pad - bw, by = pad + 6 * S;
  ctx.strokeStyle = white;
  ctx.lineWidth = Math.max(2, Math.round(2.5 * S));
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = 'rgba(240,240,235,.9)';
  ctx.fillRect(bx + 5 * S, by + 5 * S, bw * 0.55, bh - 10 * S);
  ctx.font = font(22 * S);
  ctx.fillStyle = 'rgba(230,230,225,.8)';
  ctx.fillText('BATT', W - pad - 96 * S, pad + 18 * S);

  // 日期（右下，经典 camcorder 日期戳）
  ctx.font = `bold ${font(34 * S)}`;
  ctx.textAlign = 'right';
  const date = (eraMeta().date || '1987.08.12');
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  ctx.fillStyle = 'rgba(250,245,225,.95)';
  ctx.fillText(`${date.replace(/\./g, '  ')}   ${time}`, W - pad, H - pad - 16 * S);
  ctx.font = font(24 * S);
  ctx.fillStyle = 'rgba(235,230,215,.78)';
  ctx.fillText(`${eraMeta().camcorder || 'Video8'} · CAMERA`, W - pad, H - pad - 60 * S);

  // 变焦 / 胶卷
  ctx.textAlign = 'left';
  ctx.font = `bold ${font(30 * S)}`;
  ctx.fillStyle = white;
  const zoom = (72 / state.view.fov).toFixed(1);
  ctx.fillText(`×${zoom}`, pad, H - pad - 16 * S);
  ctx.font = font(22 * S);
  ctx.fillStyle = 'rgba(235,230,220,.75)';
  ctx.fillText(`${eraMeta().label}`, pad, H - pad - 58 * S);

  ctx.restore();
}


/* ---------------- loading ---------------- */
function setLoading(show, title, tip, progress) {
  $('loading').classList.toggle('hidden', !show);
  if (title) $('loading-title').textContent = title;
  if (tip) $('loading-tip').textContent = tip;
  if (typeof progress === 'number') $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
}

function loadEra(era, opts = {}) {
  if (state.view3d) {
    state.era = era;
    const frame = $('godot-base');
    if (frame && !frame.src.includes(`scene=${era}`)) frame.src = godotURL(era);
    renderEraTabs();
    buildMarkers3D();
    updateCamLabels();
    return Promise.resolve();
  }
  if (is3D()) {
    state.era = era;
    renderEraTabs();
    return loadModel3D(era).then(() => {
      updateCamLabels();
      if (state.cam.active) layoutCamcorder();
    });
  }
  if (state.era === era && state.texture && !opts.force) return Promise.resolve();
  const meta = eraMeta(era);
  setLoading(true, `正在进入 ${meta.label}…`, '360° 实景由 Godot 原始场景渲染，包含游戏里的真实光影', 0.15);
  return new Promise((resolve) => {
    loader.load(
      meta.pano,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (state.texture) state.texture.dispose();
        state.texture = tex;
        uniforms.map.value = tex;
        uniforms.fwd.value.fromArray(meta.forward);
        uniforms.rightU.value.fromArray(meta.right);
        uniforms.upU.value.fromArray(meta.up);
        state.era = era;
        state.view = { yaw: opts.yaw ?? 0, pitch: opts.pitch ?? 0, fov: opts.fov ?? 72 };
        state.target = { ...state.view };
        state.anim = null;
        state.selectedId = null;
        $('exhibit-card').classList.add('hidden');
        buildHotspots();
        renderEraTabs();
        if (state.cam.active) {
          state.cam.pos.set(0, 0, 0);
          state.view.fov = Math.min(state.view.fov, 72);
          updateCamLabels();
          layoutCamcorder();
        }
        state.free.pos.set(0, 0, 0);
        setLoading(false);
        if (!opts.silent) toast(`已进入 ${meta.label}`);
        resolve();
      },
      (evt) => {
        if (evt && evt.total) {
          $('loading-bar').style.width = `${Math.round(clamp(evt.loaded / evt.total, 0, 0.95) * 100)}%`;
        } else {
          $('loading-bar').style.width = '60%';
        }
      },
      (err) => {
        console.error(err);
        setLoading(true, '全景图加载失败', '请确认 assets/pano 下的 jpg 文件存在。', 1);
        resolve();
      }
    );
  });
}

/* ---------------- hotspots ---------------- */
function buildHotspots() {
  hotspotLayer.innerHTML = '';
  state.hotspots = state.data.exhibits
    .filter((e) => e.scene === state.era)
    .map((e) => {
      const el = document.createElement('button');
      el.className = 'hotspot';
      el.dataset.id = e.id;
      el.innerHTML = `<span class="hs-dot"></span><span class="hs-label">${e.name}</span>`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectExhibit(e.id, { fly: true, openCard: true });
      });
      hotspotLayer.appendChild(el);
      return { id: e.id, el, pos: dirFromYawPitch(e.yaw, e.pitch) };
    });
}

const proj = new THREE.Vector3();
function updateHotspots() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const forward = dirFromYawPitch(0, 0);
  state.hotspots.forEach((hs) => {
    const dir = hs.pos.clone().multiplyScalar(100);
    proj.copy(dir).project(camera);
    const behind = proj.z > 1 || hs.pos.dot(forward) < -0.15;
    hs.el.classList.toggle('hidden', behind);
    if (behind) return;
    const x = (proj.x * 0.5 + 0.5) * w;
    const y = (-proj.y * 0.5 + 0.5) * h;
    hs.el.style.left = `${x}px`;
    hs.el.style.top = `${y}px`;
    hs.el.classList.toggle('active', hs.id === state.selectedId);
  });
}

/* ---------------- view control ---------------- */
function setView(yaw, pitch, fov, duration = 0) {
  state.target = { yaw: clamp(yaw, -180, 180), pitch: clamp(pitch, -75, 75), fov: clamp(fov, 22, 82) };
  if (duration <= 0) {
    state.view = { ...state.target };
    state.anim = null;
    applyCamera();
    return;
  }
  state.anim = {
    t0: performance.now(),
    dur: duration,
    from: { ...state.view },
    to: { ...state.target },
  };
}

function flyToExhibit(ex, opts = {}) {
  // 镜头拉近到展品：按物件大小使用每件展品的 zoom（fov 16–26），确保看得到物件
  setView(ex.yaw, ex.pitch, opts.fov ?? ex.zoom ?? 28, opts.duration ?? 1100);
}

function updateModeButton() {
  const b = $('btn-godot3d');
  if (b) b.textContent = state.view3d ? '360 实景' : '3D 漫游';
  const hint = $('hint-bar');
  if (hint) hint.textContent = state.view3d
    ? '3D 漫游：点击画面后 WASD 走动 · 鼠标环视 · Shift 加速 · Q/E 升降 · Esc 释放鼠标 · 点金色光点看展品'
    : '拖动环视 · WASD/方向键飞行（Shift 加速/QE 升降）· 右键拖拽平移 · 滚轮缩放';
}

async function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  if (mode === '3d') {
    document.body.classList.add('mode-3d');
    hotspotLayer.style.display = 'none';
    state.free.vel.set(0, 0, 0);
    // 背景用该场景的实景全景做天空（GLB 不含游戏天空/水面 shader）
    try {
      const meta = eraMeta(state.era);
      await new Promise((resolve) => {
        loader.load(meta.pano, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.mapping = THREE.EquirectangularReflectionMapping;
          scene.background = tex;
          scene.backgroundIntensity = 1.0;
          resolve();
        }, undefined, () => resolve());
      });
    } catch (e) {}
    await loadModel3D(state.era);
  } else {
    document.body.classList.remove('mode-3d');
    clearModel3D();
    const hemi = scene.getObjectByName('__lead_hemi');
    if (hemi) scene.remove(hemi);
    pano.visible = true;
    state.free.pos.set(0, 0, 0);
    state.free.vel.set(0, 0, 0);
    await loadEra(state.era, { force: true, silent: true });
    hotspotLayer.style.display = '';
  }
  updateModeButton();
  updateCamLabels();
  if (state.cam.active) layoutCamcorder();
}

async function selectExhibit(id, opts = {}) {
  const ex = state.agent.byId.get(id);
  if (!ex) return;
  if (state.view3d) {
    if (ex.scene !== state.era) {
      window.__pendingFocus3D = ex.pos3d || null;
      window.__pendingFocusEra = ex.scene;
      setView3D(true, ex.scene);
    } else {
      focus3D(ex);
    }
    state.selectedId = id;
    try { localStorage.setItem('museum-last-exhibit', id); } catch (e) {}
    recordVisit(ex);
    if (opts.openCard !== false) renderCard(ex);
    showFocusRing();
    return;
  }
  if (is3D()) await setMode('pano');
  if (ex.scene !== state.era) {
    await loadEra(ex.scene, { silent: true });
  }
  state.selectedId = id;
  try { localStorage.setItem('museum-last-exhibit', id); } catch (e) {}
  recordVisit(ex);
  if (opts.fly !== false) flyToExhibit(ex, opts);
  if (opts.openCard !== false) renderCard(ex);
  showFocusRing();
}

function showFocusRing() {
  const ring = $('focus-ring');
  if (!ring) return;
  ring.classList.remove('show');
  void ring.offsetWidth;
  ring.classList.add('show');
  clearTimeout(showFocusRing._t);
  showFocusRing._t = setTimeout(() => ring.classList.remove('show'), 1400);
}

function renderCard(ex) {
  $('card-era').textContent = eraMeta(ex.scene).label;
  $('card-name').textContent = ex.name;
  $('card-tagline').textContent = ex.tagline;
  $('card-year').textContent = ex.year;
  $('card-price').textContent = ex.price;
  $('card-desc').textContent = ex.desc;
  $('exhibit-card').classList.remove('hidden');
}

/* ---------------- chat ---------------- */
function addMsg(role, html) {
  const log = $('chat-log');
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = html;
  wrap.appendChild(bubble);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return wrap;
}
const fmtReply = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/\n/g, '<br>');
const stripMd = (text) => String(text).replace(/\*\*(.+?)\*\*/g, '$1').replace(/<[^>]+>/g, '');

function speak(text) {
  if (!state.voice || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(stripMd(text).slice(0, 220));
    u.lang = 'zh-CN';
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

function renderChips(list) {
  const box = $('chat-chips');
  box.innerHTML = '';
  (list || []).slice(0, 4).forEach((t) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = t;
    b.addEventListener('click', () => sendMessage(t));
    box.appendChild(b);
  });
}

function setAgentStatus(text) {
  $('agent-status').innerHTML = `<span class="dot"></span>${text}`;
}

async function sendMessage(text) {
  text = String(text || '').trim();
  if (!text) return;
  stopTourUI();
  state.routeToken++;
  addMsg('user', fmtReply(text));
  state.memory.questions.push({ text, ts: Date.now() });
  if (state.memory.questions.length > 80) state.memory.questions.splice(0, state.memory.questions.length - 80);
  saveMemory();
  state.history.push({ role: 'user', content: text });
  const typing = addMsg('agent typing', '小奖正在想…');
  try {
    const res = await state.agent.respond(text, {
      era: state.era,
      selectedId: state.selectedId,
      history: state.history,
      memory: state.memory,
    });
    typing.remove();
    const wrap = addMsg('agent', '');
    const bubble = wrap.querySelector('.bubble');
    const traceEl = renderTrace(bubble, res.trace);
    const replyEl = document.createElement('div');
    replyEl.className = 'reply';
    replyEl.innerHTML = fmtReply(res.reply);
    bubble.appendChild(replyEl);
    state.history.push({ role: 'assistant', content: res.reply });
    if (state.history.length > 24) state.history.splice(0, state.history.length - 24);
    if (res.chips) renderChips(res.chips);
    speak(res.reply);
    await execActions(res.actions || [], traceEl);
    finishTrace(traceEl);
  } catch (err) {
    typing.remove();
    addMsg('agent', '讲解员开小差了，请再试一次。');
    console.error(err);
  }
}

/* ---------------- 规划轨迹 UI ---------------- */
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function renderTrace(bubble, trace) {
  if (!trace || !trace.length) return null;
  const toolCount = trace.filter((s) => s.kind === 'tool').length;
  const box = document.createElement('div');
  box.className = 'trace running';
  box.innerHTML = `<div class="trace-head"><span class="trace-ico">⚙</span><span class="trace-title">小奖的行动轨迹</span><span class="trace-progress">0/${toolCount}</span><span class="trace-toggle">收起</span></div><ol class="trace-steps"></ol>`;
  const ol = box.querySelector('.trace-steps');
  trace.forEach((s) => {
    const li = document.createElement('li');
    li.className = `trace-step ${s.kind}`;
    li.dataset.tool = s.tool || '';
    li.dataset.state = 'pending';
    const ico = s.kind === 'think' ? '💭' : s.kind === 'tool' ? '🔧' : '✅';
    li.innerHTML = `<span class="ti">${ico}</span><span class="tt">${escText(s.text)}</span><span class="ts"></span>`;
    ol.appendChild(li);
  });
  box.querySelector('.trace-head').addEventListener('click', () => box.classList.toggle('collapsed'));
  bubble.appendChild(box);
  return box;
}
function markTrace(traceEl, tool, phase) {
  if (!traceEl) return;
  const steps = [...traceEl.querySelectorAll('.trace-step.tool')];
  const target = steps.find((s) => s.dataset.state !== 'done' && s.dataset.tool === tool)
    || steps.find((s) => s.dataset.state === 'pending' && s.dataset.tool === tool);
  if (!target) return;
  target.dataset.state = phase;
  target.querySelector('.ts').textContent = phase === 'run' ? '执行中…' : '完成';
  target.classList.toggle('done', phase === 'done');
  const done = traceEl.querySelectorAll('.trace-step.tool[data-state="done"]').length;
  const total = traceEl.querySelectorAll('.trace-step.tool').length;
  traceEl.querySelector('.trace-progress').textContent = `${done}/${total}`;
}
function finishTrace(traceEl) {
  if (!traceEl) return;
  traceEl.classList.remove('running');
  traceEl.classList.add('finished');
  traceEl.querySelectorAll('.trace-step.tool[data-state="run"]').forEach((s) => {
    s.dataset.state = 'done';
    s.classList.add('done');
    s.querySelector('.ts').textContent = '完成';
  });
  const done = traceEl.querySelectorAll('.trace-step.tool[data-state="done"]').length;
  const total = traceEl.querySelectorAll('.trace-step.tool').length;
  traceEl.querySelector('.trace-progress').textContent = `${done}/${total}`;
  setTimeout(() => { if (traceEl.isConnected) traceEl.classList.add('collapsed'); }, 6000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function execActions(actions, traceEl) {
  for (const a of actions) {
    if (!a || !a.type) continue;
    markTrace(traceEl, a.type, 'run');
    if (a.type === 'switchEra') {
      if (a.era !== state.era) await loadEra(a.era, { silent: true });
      await sleep(220);
    } else if (a.type === 'goto') {
      const ex = state.agent.byId.get(a.id);
      if (ex) {
        if (ex.scene !== state.era) await loadEra(ex.scene, { silent: true });
        await selectExhibit(a.id, { fly: true, openCard: true });
        await sleep(1050);
      }
    } else if (a.type === 'highlight') {
      if (a.id && a.id === state.selectedId) showFocusRing();
      await sleep(80);
    } else if (a.type === 'openEvolution') {
      openEvolution();
      await sleep(100);
    } else if (a.type === 'openRoute') {
      openRoute();
      await sleep(100);
    } else if (a.type === 'startRoute') {
      runRoute(a.route);
      await sleep(100);
    } else if (a.type === 'startTour') {
      startAutonomousTour(a.route || '5分钟精华');
      await sleep(100);
    } else if (a.type === 'openReport') {
      openReport();
      await sleep(100);
    } else if (a.type === 'openCamera') {
      if (state.cam.active) { capturePhoto(); } else { enterCamcorder(); }
      await sleep(260);
    } else if (a.type === 'simulate') {
      const ex = state.agent.byId.get(a.id) || state.agent.byId.get(state.selectedId);
      if (ex) openSimulator(ex, { eraLabel: eraMeta(ex.scene).label });
      await sleep(160);
    } else if (a.type === 'camera') {
      if (!state.cam.active) enterCamcorder();
      if (a.focal || a.tele || a.nd) {
        setExpertMode(true);
        if (a.focal) state.cam.expertParams.focal = clamp(a.focal, 24, 200);
        if (a.tele) state.cam.expertParams.tele = a.tele;
        if (typeof a.nd === 'number') state.cam.expertParams.nd = a.nd;
        applyExpertParams();
      } else {
        if (a.zoom) setView(state.view.yaw, state.view.pitch, clamp(a.zoom, 18, 72), 600);
        if (typeof a.exposure === 'number') state.cam.params.exposure = clamp(a.exposure, 0.4, 2.2);
        if (typeof a.grain === 'number') state.cam.params.grain = clamp(a.grain, 0, 0.3);
        if (typeof a.warm === 'number') state.cam.params.warm = clamp(a.warm, -0.25, 0.4);
        applyCamParams();
      }
      await sleep(160);
    } else if (a.type === 'cameraStyle') {
      applyCameraStyle(a);
      await sleep(200);
    }
    markTrace(traceEl, a.type, 'done');
  }
}

/* ---------------- 参观报告 ---------------- */
function reportData() {
  const visited = state.memory.visited || [];
  const eraOrder = Object.keys(state.data.meta.eras);
  const scenes = eraOrder.filter((k) => visited.some((v) => v.scene === k));
  const mins = Math.max(1, Math.round((Date.now() - (state.memory.startedAt || Date.now())) / 60000));
  return { visited, scenes, mins, count: visited.length };
}
function reportSummary(d) {
  if (!d.count) return '还没开始逛，先去 1980 商店看看？';
  const labels = d.scenes.map((k) => state.data.meta.eras[k].label);
  if (d.scenes.length >= 3) return `三个场景都走到了——${d.count} 件展品串起来，就是一部“数码如何进入生活”的简史。`;
  if (d.scenes.length === 2) return `你从 ${labels[0]} 走到了 ${labels[1]}，${d.count} 件展品里能看到生活被数码一点点改变。`;
  return `你在 ${labels[0] || '展厅'}看了 ${d.count} 件展品；换到另一个场景，会看到同一条数码脉络的另一段。`;
}
function reportText() {
  const d = reportData();
  const lines = [
    '数码考古馆 · 参观报告',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    `参观时长：约 ${d.mins} 分钟`,
    `走过场景：${d.scenes.map((k) => state.data.meta.eras[k].label).join(' / ') || '—'}`,
    `看过展品：${d.count} 件`,
    '',
  ];
  d.scenes.forEach((k) => {
    lines.push(`【${state.data.meta.eras[k].label}】`);
    d.visited.filter((v) => v.scene === k).forEach((v, i) => lines.push(`  ${i + 1}. ${v.name}`));
    lines.push('');
  });
  lines.push(`小奖的一句话：${reportSummary(d)}`);
  return lines.join('\n');
}
function openReport() {
  const d = reportData();
  const stats = `<div class="report-stats">
    <div><b>${d.scenes.length}</b><span>场景</span></div>
    <div><b>${d.count}</b><span>展品</span></div>
    <div><b>${d.mins}</b><span>分钟</span></div>
  </div>`;
  const timeline = d.scenes.map((k) => {
    const items = d.visited.filter((v) => v.scene === k);
    return `<div class="report-era"><h4>${state.data.meta.eras[k].label}</h4><ul>${items.map((v) => `<li>${v.name}</li>`).join('')}</ul></div>`;
  }).join('');
  const body = d.count
    ? `${stats}<div class="report-timeline">${timeline}</div><p class="report-summary">小奖：${reportSummary(d)}</p>`
    : `<p class="report-empty">你还没看过展品。要不要先让我用“自主巡展”带你走一圈？</p>`;
  $('report-body').innerHTML = body;
  openModal('modal-report');
}

/* ---------------- 自主巡展 ---------------- */
function startAutonomousTour(name = '5分钟精华') {
  const ids = (state.data.routes || {})[name] || [];
  if (!ids.length) return;
  stopTourUI();
  const token = ++state.routeToken;
  state.tour = { name, total: ids.length, index: 0 };
  $('tour-banner').classList.remove('hidden');
  updateTourBanner(0);
  addMsg('agent', fmtReply(`**自主巡展开始** · ${name}\n我会自己规划并依次带你看 ${ids.length} 件展品，随时可以点右上角「停下」打断我。`));
  (async () => {
    for (let i = 0; i < ids.length; i++) {
      if (token !== state.routeToken) return;
      const ex = state.agent.byId.get(ids[i]);
      if (!ex) continue;
      state.tour.index = i + 1;
      updateTourBanner(i + 1, ex);
      addMsg('agent', fmtReply(`第 ${i + 1}/${ids.length} 站 · **${ex.name}**（${ex.year}）\n${ex.tagline}`));
      if (ex.scene !== state.era) {
        await loadEra(ex.scene, { silent: true });
        await sleep(280);
      }
      if (token !== state.routeToken) return;
      await selectExhibit(ex.id, { fly: true, openCard: true });
      speak(`${ex.name}。${ex.tagline}`);
      await waitOrCancel(4200, token);
    }
    if (token === state.routeToken) {
      stopTourUI();
      addMsg('agent', '自主巡展结束。我把这次的参观记录整理成报告了。');
      renderChips(['生成参观报告', '数码进化树', '有什么展品']);
      openReport();
    }
  })();
}
function updateTourBanner(i, ex) {
  if (!state.tour) return;
  const total = state.tour.total;
  $('tour-progress').textContent = i > 0 ? `第 ${i}/${total} 站 · ${ex ? ex.name : ''}` : `准备出发 · 共 ${total} 站`;
  const bar = $('tour-bar');
  if (bar) bar.style.width = `${Math.round((i / total) * 100)}%`;
}
function stopTourUI() {
  state.tour = null;
  const b = $('tour-banner');
  if (b) b.classList.add('hidden');
}
function stopTour(silent) {
  state.routeToken++;
  stopTourUI();
  if (!silent) addMsg('agent', '已停下。想继续就说“自主巡展”，或者告诉我具体想看哪一件。');
}

/* ---------------- routes ---------------- */
async function runRoute(name) {
  const ids = (state.data.routes || {})[name] || [];
  if (!ids.length) return;
  const token = ++state.routeToken;
  toast(`开始参观：${name}`);
  addMsg('agent', `我们开始 **${name}** 参观，我会带你依次看过去。`);
  for (let i = 0; i < ids.length; i++) {
    if (token !== state.routeToken) return;
    const ex = state.agent.byId.get(ids[i]);
    if (!ex) continue;
    addMsg('agent', fmtReply(`第 ${i + 1} 件 · **${ex.name}**（${ex.year}）\n${ex.tagline}\n${ex.desc}`));
    if (ex.scene !== state.era) {
      await loadEra(ex.scene, { silent: true });
      await sleep(260);
    }
    if (token !== state.routeToken) return;
    selectExhibit(ex.id, { fly: true, openCard: true });
    speak(`${ex.name}。${ex.tagline}`);
    await waitOrCancel(4200, token);
  }
  if (token === state.routeToken) {
    addMsg('agent', '参观结束。想看某件展品的细节，随时问我。');
    renderChips(['生成参观报告', '数码进化树', '带我去看自动售货机', '有什么展品']);
  }
}

function waitOrCancel(ms, token) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (token !== state.routeToken || performance.now() - start >= ms) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/* ---------------- modals ---------------- */
function openModal(id) {
  document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function closeModal(id) { $(id).classList.add('hidden'); }

function openEvolution() {
  const track = $('evo-track');
  track.innerHTML = '';
  state.data.evolution.forEach((node) => {
    const div = document.createElement('div');
    div.className = 'evo-item' + (node.exhibit ? '' : ' disabled');
    div.innerHTML = `<span class="evo-year">${node.year}</span><div class="evo-node"></div><h4>${node.name}</h4><p>${node.note}</p>`;
    if (node.exhibit) {
      const b = document.createElement('button');
      b.textContent = '带我去看';
      b.addEventListener('click', () => {
        closeModal('modal-evolution');
        const ex = state.agent.byId.get(node.exhibit);
        if (ex) {
          selectExhibit(ex.id, { fly: true, openCard: true });
          addMsg('agent', fmtReply(`这里是 **${ex.name}**（${ex.year}）。${ex.tagline}\n${ex.desc}`));
        }
      });
      div.appendChild(b);
    }
    track.appendChild(div);
  });
  openModal('modal-evolution');
}

function openRoute() {
  const list = $('route-list');
  list.innerHTML = '';
  Object.keys(state.data.routes || {}).forEach((name) => {
    const ids = state.data.routes[name] || [];
    const b = document.createElement('button');
    b.className = 'route-item';
    const names = ids.map((id) => state.agent.byId.get(id)?.name).filter(Boolean).join(' → ');
    b.innerHTML = `<strong>${name}</strong><span>${names}</span>`;
    b.addEventListener('click', () => { closeModal('modal-route'); runRoute(name); });
    list.appendChild(b);
  });
  openModal('modal-route');
}

/* ---------------- UI ---------------- */
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function renderEraTabs() {
  const tabs = $('era-tabs');
  tabs.innerHTML = '';
  Object.entries(state.data.meta.eras).forEach(([era, meta]) => {
    const b = document.createElement('button');
    b.className = 'era-tab' + (era === state.era ? ' active' : '');
    b.dataset.era = era;
    b.innerHTML = `${meta.label}<small>${meta.desc.split('，')[0]}</small>`;
    b.addEventListener('click', () => {
      state.routeToken++;
      if (era !== state.era) loadEra(era);
    });
    tabs.appendChild(b);
  });
}

function bindUI() {
  $('btn-evolution').addEventListener('click', openEvolution);
  $('btn-route').addEventListener('click', openRoute);
  $('btn-help').addEventListener('click', () => openModal('modal-help'));
  $('btn-autotour').addEventListener('click', () => startAutonomousTour('5分钟精华'));
  $('btn-tour-stop').addEventListener('click', () => stopTour());
  $('btn-camera').addEventListener('click', () => (state.cam.active ? exitCamcorder() : enterCamcorder()));
  $('btn-godot3d').addEventListener('click', () => setView3D(!state.view3d, state.era));
  const modeBtn = $('btn-mode3d');
  if (modeBtn) modeBtn.addEventListener('click', () => setMode(is3D() ? 'pano' : '3d'));
  $('btn-cam-shot').addEventListener('click', capturePhoto);
  $('btn-cam-exit').addEventListener('click', exitCamcorder);
  ['cam-exposure', 'cam-grain', 'cam-warm'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      state.cam.params[id.split('-')[1]] = parseFloat(el.value);
      applyCamParams();
    });
  });
  // 专家模式
  const expertToggle = $('btn-expert');
  if (expertToggle) expertToggle.addEventListener('click', () => setExpertMode(true));
  const expertClose = $('btn-expert-close');
  if (expertClose) expertClose.addEventListener('click', () => setExpertMode(false));
  document.querySelectorAll('[data-tele]').forEach((b) => {
    b.addEventListener('click', () => {
      state.cam.expertParams.tele = parseFloat(b.dataset.tele);
      document.querySelectorAll('[data-tele]').forEach((x) => x.classList.toggle('active', x === b));
      applyExpertParams();
    });
  });
  document.querySelectorAll('[data-nd]').forEach((b) => {
    b.addEventListener('click', () => {
      state.cam.expertParams.nd = parseInt(b.dataset.nd, 10);
      document.querySelectorAll('[data-nd]').forEach((x) => x.classList.toggle('active', x === b));
      applyExpertParams();
    });
  });
  document.querySelectorAll('[data-pol]').forEach((b) => {
    b.addEventListener('click', () => {
      state.cam.expertParams.polarizer = !state.cam.expertParams.polarizer;
      b.classList.toggle('active', state.cam.expertParams.polarizer);
      applyExpertParams();
    });
  });
  const EXPERT_MAP = {
    'exp-focal': 'focal', 'exp-fstop': 'fstop', 'exp-shutter': 'shutter', 'exp-iso': 'iso',
    'exp-wb': 'wb', 'exp-ev': 'ev', 'exp-sat': 'saturation', 'exp-focus': 'focus',
  };
  Object.entries(EXPERT_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      state.cam.expertParams[key] = parseFloat(el.value);
      applyExpertParams();
    });
  });
  // AI 指导
  const aiForm = $('cam-ai-form');
  if (aiForm) {
    aiForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('cam-ai-input');
      const v = input ? input.value.trim() : '';
      if (input) input.value = '';
      askCameraAI(v);
    });
  }
  document.querySelectorAll('[data-style]').forEach((b) => {
    b.addEventListener('click', () => askCameraAI(b.textContent));
  });
  $('card-sim').addEventListener('click', () => {
    const ex = state.agent.byId.get(state.selectedId);
    if (ex) openSimulator(ex, { eraLabel: eraMeta(ex.scene).label });
  });
  $('btn-report-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(reportText()); toast('报告文字已复制'); } catch (e) { toast('复制失败，可手动选择文字'); }
  });
  $('btn-report-download').addEventListener('click', () => {
    const blob = new Blob([reportText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `数码考古馆-参观报告-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('报告已下载');
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
    closeModal(b.dataset.close);
    if (b.dataset.close === 'modal-sim') closeSimulator();
  }));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => {
    if (e.target !== m) return;
    m.classList.add('hidden');
    if (m.id === 'modal-sim') closeSimulator();
    if (m.id === 'modal-3d') closeGodot();
  }));

  $('card-close').addEventListener('click', () => { $('exhibit-card').classList.add('hidden'); state.selectedId = null; });
  $('card-goto').addEventListener('click', () => { if (state.selectedId) selectExhibit(state.selectedId, { fly: true, openCard: false }); });
  $('card-ask').addEventListener('click', () => {
    const ex = state.agent.byId.get(state.selectedId);
    if (ex) sendMessage(`介绍一下${ex.name}`);
  });

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('chat-text');
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    sendMessage(v);
  });

  $('btn-voice').addEventListener('click', () => {
    state.voice = !state.voice;
    $('btn-voice').style.opacity = state.voice ? '1' : '.45';
    toast(state.voice ? '语音播报已开启' : '语音播报已关闭');
  });
  $('btn-voice').style.opacity = '.45';

  $('btn-start').addEventListener('click', () => {
    $('intro').classList.add('hidden');
    greet();
  });

  // drag look
  const canvas = renderer.domElement;
  const wrapYaw = (v) => ((v + 180) % 360 + 360) % 360 - 180;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    state.dragging = true;
    state.dragMode = (e.button === 1 || e.button === 2) ? 'pan' : 'look';
    state.lastPointer = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = state.dragMode === 'pan' ? 'grabbing' : 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    if (e.button === 1) e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.dragging || !state.lastPointer) return;
    const dx = e.clientX - state.lastPointer.x;
    const dy = e.clientY - state.lastPointer.y;
    state.lastPointer = { x: e.clientX, y: e.clientY };
    state.anim = null;
    if (state.dragMode === 'pan') {
      // 右键/中键拖拽：平移机位（像 3D 软件里平移视图）
      const forward = dirFromYawPitch(state.view.yaw, 0);
      const upV = new THREE.Vector3().fromArray(eraMeta().up);
      const rightV = new THREE.Vector3().crossVectors(forward, upV).normalize();
      const factor = state.cam.active ? 0.06 : 0.09;
      const pos = state.cam.active ? state.cam.pos : state.free.pos;
      pos.addScaledVector(rightV, -dx * factor);
      pos.addScaledVector(upV, dy * factor);
      const range = state.cam.active ? FLY.camRange : FLY.freeRange;
      if (pos.length() > range) pos.setLength(range);
    } else {
      // 左键拖拽：像第一人称/FPS 一样转动镜头（右拖看右、下拖看下）
      state.view.yaw = wrapYaw(state.view.yaw + dx * 0.24);
      state.view.pitch = clamp(state.view.pitch - dy * 0.20, -78, 78);
    }
  });
  const endDrag = () => { state.dragging = false; state.lastPointer = null; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.style.cursor = 'grab';
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.anim = null;
    if (state.cam.active) {
      // 数码变焦：光学到头之后只是裁切放大（会糊）
      const p = state.cam.expertParams;
      const effFocal = (p.focal || 35) * (p.tele || 1);
      const opticalFov = lensFov(effFocal);
      const dz = clamp(opticalFov / Math.max(6, state.view.fov), 1, 8);
      const next = clamp(dz * (1 - e.deltaY * 0.0018), 1, 8);
      state.view.fov = clamp(opticalFov / next, 6, 72);
      const c = state.cam.params;
      c.focusBlur = clamp((p.focus || 0) / 100 * 0.6 + (p.tele - 1) * 0.06 + (next - 1) * 0.12, 0, 0.9);
      camUniforms.focusBlur.value = c.focusBlur;
      const ro = $('lens-readout');
      if (ro) ro.dataset.digital = next.toFixed(1);
      return;
    }
    const lo = 18;
    const hi = 80;
    state.view.fov = clamp(state.view.fov + e.deltaY * 0.055, lo, hi);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return; // 输入框里打字不移动
    const k = e.key.toLowerCase();
    const moveKeys = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    if (state.cam.active) {
      if (moveKeys.includes(k)) {
        e.preventDefault();
        state.cam.keys.add(k);
        return;
      }
      if (e.key === ' ') { e.preventDefault(); capturePhoto(); return; }
      if (e.key === 'Escape') { e.preventDefault(); exitCamcorder(); return; }
    } else {
      // 默认自由视角：前后左右移动
      if (moveKeys.includes(k)) {
        e.preventDefault();
        state.free.keys.add(k);
        return;
      }
      if (k === 'shift') state.free.keys.add('shift');
    }
    if (e.key === 'r' || e.key === 'R') { state.free.pos.set(0, 0, 0); state.free.vel.set(0, 0, 0); if (state.cam.active) { state.cam.pos.set(0, 0, 0); state.cam.vel.set(0, 0, 0); } setView(0, 0, 72, 500); toast('已回到初始机位'); }
    if (e.key === 'v' || e.key === 'V') openEvolution();
    if (e.key === 'c' || e.key === 'C') { state.cam.active ? exitCamcorder() : enterCamcorder(); }
    if (e.key === 'Escape' && state.tour) stopTour();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    state.cam.keys.delete(k);
    state.free.keys.delete(k);
    if (k === 'shift') state.free.keys.delete('shift');
  });
  window.addEventListener('resize', onResize);
}

function onResize() {
  if (state.cam.active) {
    layoutCamcorder();
  } else {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

/* ---------------- intro ---------------- */
function greet() {
  const label = eraMeta().label;
  const recent = (state.memory.visited || []).slice(-1)[0];
  const extra = recent ? `\n上次你看到过 **${recent.name}**，这次可以接着逛。` : '';
  addMsg('agent', fmtReply(
    `欢迎来到 **数码考古馆**，我是讲解员**小奖**。\n当前是 **${label}**。你可以按 **WASD 自由走动**（点击画面后鼠标环视），点金色光点看展品，或直接说“带我去看传真机”。${extra}\n我还能**自主巡展**（自己规划路线带你走完），也能按你的参观记录**生成报告**。`
  ));
  renderChips(['带我去看传真机', '自主巡展', '生成参观报告', '打开摄像机']);
}

/* ---------------- boot ---------------- */
async function boot() {
  try {
    const res = await fetch('data/exhibits.json');
    state.data = await res.json();
    state.memory = loadMemory() || { visited: [], questions: [], startedAt: Date.now(), lastVisit: 0 };
    state.agent = createAgent(state.data);
    bindUI();

    fetch('/api/health').then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok) setAgentStatus(j.llm ? '在线 · 大模型讲解' : '在线 · 本地知识库'); })
      .catch(() => setAgentStatus('在线 · 本地知识库'));

    const exParam = params.get('exhibit');
    const exRecord = exParam ? (state.data.exhibits || []).find((e) => e.id === exParam) : null;
    const startEra = ['1980', '1994', 'mart'].includes(params.get('scene')) ? params.get('scene') : (exRecord ? exRecord.scene : 'shop');
    await loadEra(startEra, { silent: true });
    state.ready = true;
    window.__museumReady = true;
    window.__museumDebug = { status: 'ready', era: state.era };
    window.__museum = { state, selectExhibit, sendMessage, loadEra, openEvolution, openRoute, setView, openReport, startAutonomousTour, stopTour, reportText, enterCamcorder, exitCamcorder, capturePhoto, openSimulator, closeSimulator, setMode };

    if (exParam && state.agent.byId.has(exParam)) {
      setTimeout(() => selectExhibit(exParam, { fly: true, openCard: true }), 500);
    }

    if (CONFIG.demo) {
      $('intro').classList.add('hidden');
      setTimeout(() => {
        greet();
        selectExhibit(exParam || 'tv', { fly: true, openCard: true });
      }, 1000);
    } else if (params.get('view') === 'pano') {
      // 兼容旧默认：360 实景优先
      $('intro').classList.remove('hidden');
    } else {
      // 默认就是 3D 主视图（Godot Web 原场景），所有操作直接在 3D 上做
      $('intro').classList.add('hidden');
      setTimeout(() => {
        setView3D(true, state.era);
        if (!$('chat-log').children.length) greet();
      }, 500);
    }
  } catch (err) {
    console.error(err);
    window.__museumDebug = { status: 'error', error: String(err) };
    setLoading(true, '启动失败', '无法加载 data/exhibits.json，请通过本地服务器打开（不要直接双击 index.html）。', 1);
  }
}

/* ---------------- render loop ---------------- */
let lastTick = performance.now();
function tick() {
  requestAnimationFrame(tick);
  if (!state.data || !state.ready) return;
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;
  if (state.anim) {
    const t = Math.min(1, (now - state.anim.t0) / state.anim.dur);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const a = state.anim.from, b = state.anim.to;
    state.view.yaw = a.yaw + (b.yaw - a.yaw) * k;
    state.view.pitch = a.pitch + (b.pitch - a.pitch) * k;
    state.view.fov = a.fov + (b.fov - a.fov) * k;
    if (t >= 1) state.anim = null;
  }
  if (state.cam.active) {
    updateCamMovement(dt);
    camera.position.copy(state.cam.pos);
    if (is3D()) applyCamera3D(); else applyCamera();
    applyCamSway(now / 1000);
    hotspotLayer.style.display = 'none';
    const zoomEl = $('cam-zoom');
    if (zoomEl) zoomEl.textContent = `×${(72 / state.view.fov).toFixed(1)}`;
  } else {
    // 默认自由视角：WASD/方向键前后左右飞行
    updateFreeMove(dt);
    camera.position.copy(state.free.pos);
    if (is3D()) applyCamera3D(); else applyCamera();
    const ind = $('move-indicator');
    if (ind) ind.textContent = state.free.moving > 0.4 ? '飞行中' : '';
    if (!state.view3d) hotspotLayer.style.display = is3D() ? 'none' : '';
  }
  if (state.cam.active) {
    camUniforms.time.value = now / 1000;
    renderer.setRenderTarget(camRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(camQuadScene, camQuadCam);
  } else {
    renderer.render(scene, camera);
  }
  if (state.view3d) {
    updateMarkers3D();
    hotspotLayer.style.display = '';
  } else {
    updateHotspots();
  }
}

boot();
tick();

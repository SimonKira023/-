// CDP 截图/测试工具（无第三方依赖，Node >= 22）
// 用法: node tools/shot.mjs <url> <out.png> [waitMs] [evalScript]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [, , url, out, waitMsArg, evalScript, widthArg, heightArg] = process.argv;
const waitMs = Number(waitMsArg || 20000);
const width = Number(widthArg || 1600);
const height = Number(heightArg || 900);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'museum-gpu-' + Date.now());
const port = 9300 + Math.floor(Math.random() * 300);

const chrome = spawn(CHROME, [
  '--hide-scrollbars', '--start-maximized',
  `--window-size=${width},${height}`, `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitVersion(timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

let ws;
let id = 0;
const pending = new Map();
const consoleLogs = [];

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, (msg) => {
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text };
  return r.result ? r.result.value : undefined;
}

async function main() {
  await waitVersion();
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((r) => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLogs.push(msg.params.type + ': ' + args);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      consoleLogs.push('EXCEPTION: ' + (d.text || '') + ' ' + ((d.exception && d.exception.description) || ''));
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(800);

  const t0 = Date.now();
  let dbg = null;
  while (Date.now() - t0 < waitMs) {
    dbg = await evaluate('window.__museumDebug ? JSON.stringify(window.__museumDebug) : null');
    if (typeof dbg === 'string' && (dbg.includes('"ready"') || dbg.includes('"error"'))) break;
    await sleep(500);
  }
  console.log('DEBUG:', dbg);
  if (consoleLogs.length) console.log('CONSOLE:\\n' + consoleLogs.slice(0, 25).join('\\n'));

  if (evalScript) {
    const r = await evaluate(evalScript, true);
    console.log('EVAL:', JSON.stringify(r));
    await sleep(2500);
  } else {
    await sleep(1500);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out, fs.statSync(out).size, 'bytes');
}

main()
  .catch((e) => { console.error('FAIL:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { ws && ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    process.exit(process.exitCode || 0);
  });

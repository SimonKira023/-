// Eval-only CDP test (no screenshot) — prints page console + eval result, exits promptly.
// Usage: node tools/eval-only.mjs <url> [waitMs] [evalScript]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [, , url, waitMsArg, evalScript] = process.argv;
const waitMs = Number(waitMsArg || 30000);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'museum-eval-' + Date.now());
const port = 9600 + Math.floor(Math.random() * 300);
const args = [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--window-size=1280,720', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', 'about:blank',
];
const chrome = spawn(CHROME, args, { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pending = new Map(); const logs = [];
function send(m, p = {}) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, (msg) => { if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result); }); ws.send(JSON.stringify({ id: mid, method: m, params: p })); }); }
async function waitVersion() { const t0 = Date.now(); while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch (e) {} await sleep(200); } throw new Error('no chrome'); }
async function evaluate(expression, awaitPromise = false) { const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }); if (r.exceptionDetails) return { error: r.exceptionDetails.text, detail: r.exceptionDetails.exception && r.exceptionDetails.exception.description }; return r.result ? r.result.value : undefined; }
try {
  await waitVersion();
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((r) => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') logs.push((msg.params.type || '') + ': ' + (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + ((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    const ready = await evaluate('window.__museumReady === true || (window.__museumDebug && window.__museumDebug.status === "error")');
    if (ready) break;
    await sleep(300);
  }
  const dbg = await evaluate('JSON.stringify(window.__museumDebug || null)');
  console.log('DEBUG:', dbg);
  if (evalScript) { const r = await evaluate(evalScript, true); console.log('EVAL:', JSON.stringify(r)); }
  if (logs.length) console.log('CONSOLE:\n' + logs.slice(0, 30).join('\n'));
  await send('Page.close').catch(() => {});
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}

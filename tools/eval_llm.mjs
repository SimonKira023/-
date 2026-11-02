// LLM 模式评测：服务端配置好 Key 后运行，走 /api/chat（真实网络 + 模型）。
// 用法：
//   1) 配好 .env 或环境变量，启动 server/serve.py
//   2) node tools/eval_llm.mjs
// 结果写入 docs/LLM评测报告.md
import fs from 'node:fs';
import { cases } from './eval_cases.mjs';

const ROOT = new URL('..', import.meta.url);
const BASE = process.env.MUSEUM_BASE || 'http://127.0.0.1:8787';
const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health || !health.ok) {
  console.error(`无法连接 ${BASE}，请先启动 server/serve.py`);
  process.exit(2);
}
if (!health.llm) {
  console.error('服务端未配置大模型 Key（/api/health: llm=false）。');
  console.error('请先按 README「接入大模型」配好 .env 并重启服务，再运行本脚本。');
  process.exit(2);
}
console.log(`\nLLM 模式评测 · provider=${health.provider} · model=${health.model}\n`);

const results = [];
for (const c of cases) {
  const t0 = performance.now();
  let res = null;
  let error = null;
  try {
    const r = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: c.text,
        era: '1980',
        selected: c.ctx?.selectedId || null,
        history: [],
        memory: c.ctx?.memory || null,
      }),
      signal: AbortSignal.timeout(60000),
    });
    res = await r.json();
    if (!r.ok) error = res.error || `http ${r.status}`;
  } catch (e) {
    error = String(e);
  }
  const ms = performance.now() - t0;
  const ok = !error && res && c.check(res);
  results.push({ ...c, ms, pass: !!ok, error, reply: res?.reply || '', actions: res?.actions || [], plan: res?.plan || [] });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.text.padEnd(22, ' ')}  ${ms.toFixed(0)}ms  ${ok ? '' : (error || '动作/回答不符合预期')}`);
}

const passed = results.filter((r) => r.pass).length;
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];

const md = [
  '# Agent 评测报告（LLM 模式）',
  '',
  `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
  `- 服务端：${BASE} · provider：**${health.provider}** · model：**${health.model}**`,
  '- 评测方式：`node tools/eval_llm.mjs`，逐条请求 `/api/chat`，检查返回的 `actions`（工具选择）与 `reply`（回答要点）',
  `- 用例数：**${results.length}** · 通过：**${passed}** · 通过率：**${((passed / results.length) * 100).toFixed(1)}%**`,
  `- 端到端时延：平均 **${avg.toFixed(0)}ms**，P95 **${p95.toFixed(0)}ms**`,
  '',
  '| # | 输入 | 期望 | 结果 | 时延(ms) | plan 步数 | actions |',
  '|---|---|---|---|---|---|---|',
  ...results.map((r, i) => `| ${i + 1} | ${r.text} | ${r.expect} | ${r.pass ? '✅' : '❌'} | ${r.ms.toFixed(0)} | ${r.plan.length} | \`${JSON.stringify(r.actions)}\` |`),
  '',
  '## 失败样例（如有）',
  '',
  ...results.filter((r) => !r.pass).map((r) => `- **${r.text}** → ${r.error || '动作/回答不符合预期'}；实际：\`${JSON.stringify(r.actions)}\``),
  ...(results.some((r) => !r.pass) ? [] : ['无。']),
  '',
  '> 提示：LLM 有时会用同义动作（例如先 switchEra 再 goto），只要关键动作与回答要点满足即判通过；失败项可据此微调系统提示词。',
].join('\n');
fs.writeFileSync(new URL('docs/LLM评测报告.md', ROOT), md, 'utf8');
console.log(`\n通过 ${passed}/${results.length} · 平均 ${avg.toFixed(0)}ms · P95 ${p95.toFixed(0)}ms`);
console.log('写出 docs/LLM评测报告.md');
if (passed !== results.length) process.exitCode = 1;

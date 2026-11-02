// Agent 评测（本地规则引擎 / 离线兜底路径）
// 用法：node tools/eval_agent.mjs
// 结果写入 docs/评测报告.md
import fs from 'node:fs';
import { createAgent } from '../js/agent.js';
import { cases } from './eval_cases.mjs';

const ROOT = new URL('..', import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL('data/exhibits.json', ROOT), 'utf8'));
globalThis.MUSEUM_CONFIG = { allowLLM: false };
const agent = createAgent(data);

const results = [];
for (const c of cases) {
  const t0 = performance.now();
  const res = await agent.respond(c.text, { era: '1980', history: [], ...(c.ctx || {}) });
  const ms = performance.now() - t0;
  results.push({ ...c, ms, pass: !!c.check(res), reply: res.reply, actions: res.actions || [], trace: res.trace || [] });
}

const passed = results.filter((r) => r.pass).length;
const rate = passed / results.length;
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];

console.log('\nAgent 评测（本地规则引擎 / 离线兜底路径）');
console.log(`用例 ${results.length} · 通过 ${passed} · 通过率 ${(rate * 100).toFixed(1)}% · 平均 ${avg.toFixed(2)}ms · P95 ${p95.toFixed(2)}ms\n`);
results.forEach((r, i) => {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  #${String(i + 1).padStart(2, '0')}  ${r.text.padEnd(22, ' ')}  ${r.ms.toFixed(2)}ms  ${r.pass ? '' : '← 期望: ' + r.expect}`);
});

const md = [
  '# Agent 评测报告（本地规则引擎）',
  '',
  `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
  '- 被测对象：`js/agent.js` 本地规则引擎（无 Key / 断网兜底路径）',
  '- 评测方式：`node tools/eval_agent.mjs`，逐条调用 `respond()`，检查返回的 `actions` 与 `reply`',
  `- 用例数：**${results.length}** · 通过：**${passed}** · 通过率：**${(rate * 100).toFixed(1)}%**`,
  `- 时延（本地）：平均 **${avg.toFixed(2)}ms**，P95 **${p95.toFixed(2)}ms**`,
  '- 说明：本地引擎在浏览器里与页面同进程，时延可忽略；大模型路径请用 `node tools/eval_llm.mjs` 单独复测。',
  '',
  '| # | 输入 | 期望 | 结果 | 时延(ms) | 轨迹步数 |',
  '|---|---|---|---|---|---|',
  ...results.map((r, i) => `| ${i + 1} | ${r.text} | ${r.expect} | ${r.pass ? '✅' : '❌'} | ${r.ms.toFixed(2)} | ${r.trace.length} |`),
  '',
  '## 失败样例（如有）',
  '',
  ...results.filter((r) => !r.pass).map((r) => `- **${r.text}**（期望：${r.expect}）→ ${JSON.stringify(r.actions)} / ${String(r.reply).slice(0, 60)}`),
  ...(results.some((r) => !r.pass) ? [] : ['无。']),
  '',
  '## 覆盖范围',
  '',
  '- 展品带路（7 条，覆盖三个展厅）、场景切换（2 条）、器物对比（3 条）、价格问答（1 条）',
  '- 进化树 / 展品清单 / 路线 / 自主巡展 / 参观报告（5 条）',
  '- 记忆与上下文指代（2 条）、本馆介绍 / 兜底 / 致谢（3 条）',
].join('\n');
fs.writeFileSync(new URL('docs/评测报告.md', ROOT), md, 'utf8');
console.log('\n写出 docs/评测报告.md');
if (passed !== results.length) process.exitCode = 1;

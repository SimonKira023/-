# Agent 评测报告（LLM 模式）

- 生成时间：2026/11/1 21:49:03
- 服务端：http://127.0.0.1:8787 · provider：**deepseek** · model：**deepseek-chat**
- 评测方式：`node tools/eval_llm.mjs`，逐条请求 `/api/chat`，检查返回的 `actions`（工具选择）与 `reply`（回答要点）
- 用例数：**24** · 通过：**24** · 通过率：**100.0%**
- 端到端时延：平均 **1478ms**，P95 **1740ms**

| # | 输入 | 期望 | 结果 | 时延(ms) | plan 步数 | actions |
|---|---|---|---|---|---|---|
| 1 | 带我去看传真机 | goto(fax) | ✅ | 1725 | 4 | `[{"type":"switchEra","era":"1994"},{"type":"goto","id":"fax"}]` |
| 2 | 带我去看自动售货机 | goto(vending) | ✅ | 1260 | 4 | `[{"type":"switchEra","era":"mart"},{"type":"goto","id":"vending"}]` |
| 3 | 带我去看 CRT 电脑 | goto(crt) | ✅ | 1476 | 4 | `[{"type":"switchEra","era":"1994"},{"type":"goto","id":"crt"}]` |
| 4 | 带我去看算盘 | goto(abacus) | ✅ | 1328 | 3 | `[{"type":"goto","id":"abacus"}]` |
| 5 | 带我去看灯塔 | goto(lighthouse) | ✅ | 1300 | 4 | `[{"type":"switchEra","era":"mart"},{"type":"goto","id":"lighthouse"}]` |
| 6 | 带我去看软盘 | goto(floppy) | ✅ | 1396 | 4 | `[{"type":"switchEra","era":"1994"},{"type":"goto","id":"floppy"}]` |
| 7 | 带我去看收银台 | goto(checkout) | ✅ | 1299 | 4 | `[{"type":"switchEra","era":"mart"},{"type":"goto","id":"checkout"}]` |
| 8 | 切换 1994 办公室 | switchEra(1994) | ✅ | 1605 | 3 | `[{"type":"switchEra","era":"1994"}]` |
| 9 | 带我逛海边便利店 | switchEra(mart) | ✅ | 1359 | 4 | `[{"type":"switchEra","era":"mart"}]` |
| 10 | 算盘和计算器有什么不同 | 对比：算盘/计算器 | ✅ | 1456 | 3 | `[{"type":"goto","id":"abacus"}]` |
| 11 | 公用电话和传真机有什么区别 | 对比：公用电话/传真机 | ✅ | 1740 | 4 | `[{"type":"switchEra","era":"1994"},{"type":"goto","id":"fax"}]` |
| 12 | 电视和 CRT 电脑有什么不同 | 对比：电视/CRT | ✅ | 1639 | 4 | `[{"type":"switchEra","era":"1980"},{"type":"goto","id":"tv"}]` |
| 13 | 传真机当年多少钱 | 价格（日元） | ✅ | 1639 | 4 | `[{"type":"switchEra","era":"1994"},{"type":"goto","id":"fax"}]` |
| 14 | 数码是怎么进化的 | openEvolution | ✅ | 1712 | 4 | `[{"type":"openEvolution"}]` |
| 15 | 有什么展品 | 说明 15 件 / 列展品 | ✅ | 1354 | 4 | `[]` |
| 16 | 给我一条 5 分钟精华路线 | startRoute(5分钟精华) | ✅ | 1538 | 4 | `[{"type":"startRoute","route":"5分钟精华"}]` |
| 17 | 自主巡展 | startTour | ✅ | 1512 | 3 | `[{"type":"startTour","route":"5分钟精华"}]` |
| 18 | 生成参观报告 | openReport | ✅ | 1352 | 4 | `[{"type":"openReport"}]` |
| 19 | 你好 | 自我介绍含「小奖」 | ✅ | 1344 | 3 | `[]` |
| 20 | 它当年多少钱 | 上下文指代 → 算盘/价格 | ✅ | 1272 | 4 | `[{"type":"highlight","id":"abacus"}]` |
| 21 | 上次我看了什么 | 记忆引用 | ✅ | 1376 | 4 | `[{"type":"highlight","id":"payphone"}]` |
| 22 | 介绍一下数码考古馆 | 本馆介绍 | ✅ | 1830 | 4 | `[{"type":"openRoute"}]` |
| 23 | 随便说点我不知道的 | 兜底引导 / 有据可查的冷知识 | ✅ | 1694 | 4 | `[{"type":"goto","id":"tv"}]` |
| 24 | 谢谢 | 致谢回复 | ✅ | 1278 | 3 | `[]` |

## 失败样例（如有）

无。

> 提示：LLM 有时会用同义动作（例如先 switchEra 再 goto），只要关键动作与回答要点满足即判通过；失败项可据此微调系统提示词。
# -*- coding: utf-8 -*-
"""数码考古馆 · 本地服务器
- 静态站点（项目根目录）
- /api/health  健康检查 + 是否配置了大模型
- /api/chat    可选的大模型讲解代理（OpenAI 兼容接口），未配置时前端自动用本地规则引擎

用法:
  python server/serve.py --port 8787
  然后浏览器打开 http://127.0.0.1:8787

可选环境变量（配置任意一个即可启用大模型讲解）:
  DEEPSEEK_API_KEY  / LLM_API_KEY  (+ LLM_BASE_URL, LLM_MODEL)
  ARK_CODING_API_KEY (+ ARK_BASE_URL, ARK_MODEL)
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXHIBITS_FILE = ROOT / "data" / "exhibits.json"
ENV_FILE = ROOT / ".env"


def load_dotenv(path: Path, override: bool = False) -> None:
    """读取项目根目录 .env（KEY=VALUE，支持 # 注释）。

    override=True 用于热加载：.env 里新增/修改的 Key 会覆盖当前进程的环境变量，
    .env 里删掉的 Key 也会被移除（不影响非 .env 来源的环境变量）。
    """
    global _DOTENV_LOADED
    current = {}
    if path.is_file():
        try:
            for raw in path.read_text(encoding="utf-8-sig").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key:
                    current[key] = value
        except Exception as exc:  # .env 写坏了也不影响本地演示
            print(f"[museum] 读取 .env 失败：{exc}")
            return
    if override:
        for key in list(_DOTENV_LOADED - set(current)):
            os.environ.pop(key, None)
    for key, value in current.items():
        if override or key not in os.environ:
            os.environ[key] = value
        _DOTENV_LOADED.add(key)


_DOTENV_LOADED = set()
load_dotenv(ENV_FILE)


def load_exhibits():
    with open(EXHIBITS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _looks_placeholder(value):
    return (not value) or ("你的" in value) or ("xxxx" in value.lower()) or ("sk-xxx" in value.lower())


def llm_config():
    load_dotenv(ENV_FILE, override=True)  # 热加载：改完 .env 刷新页面即可，无需重启
    key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY")
    if _looks_placeholder(key):
        key = None
    if key:
        base = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
        model = os.environ.get("LLM_MODEL", "deepseek-chat")
        return {"key": key, "base": base, "model": model, "name": "deepseek"}
    ark = os.environ.get("ARK_CODING_API_KEY")
    if _looks_placeholder(ark):
        ark = None
    if ark:
        base = os.environ.get("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
        model = os.environ.get("ARK_MODEL", "doubao-seed-1-6-250615")
        return {"key": ark, "base": base, "model": model, "name": "ark"}
    return None


SYSTEM_PROMPT = """你是「数码考古馆」的 AI 讲解员“小奖”。你背后是一个 360° 实景博物馆，三个展厅全部由游戏原始场景渲染（保留原光影）：1980·五金商店（era="1980"）、1994·办公室（era="1994"）、海边·便利店（era="mart"），收藏了 15 件与“数码如何进入日常生活”相关的展品。

你可以执行以下动作（只能使用这些）：
- switchEra: 切换展厅，参数 era，取值 "1980" / "1994" / "mart"
- goto: 带用户飞到某展品前并高亮，参数 id（展品 id）
- highlight: 高亮展品，参数 id
- openEvolution: 打开数码进化树
- openRoute: 打开参观路线选择
- startRoute: 开始某条路线，参数 route（"通讯线" / "办公线" / "海边线" / "5分钟精华"）
- startTour: 进入自主巡展模式，参数 route（同上），由前端自动带用户走完
- openReport: 生成并打开用户的参观报告

输出必须是严格的 JSON，不要 markdown 代码块：
{"reply": "中文讲解，80-150 字，可用 **加粗**", "plan": ["识别意图：带路 + 展品", "匹配知识库：传真机（id=fax）", "切换展厅：1994", "定位并高亮展品"], "actions": [{"type": "switchEra", "era": "1994"}, {"type": "goto", "id": "fax"}]}

plan 是给用户看的 3-5 步行动轨迹，每步不超过 20 字，必须具体（提到了什么展品/展厅/工具）。

规则：
1. 用户问某展品时，先 goto 再讲解，讲解要包含年代、当年价格/生活背景、它改变了什么。
2. 用户说“带我/带我去/看看”时，必须返回 goto 动作，不能只聊天。
3. 用户问对比时，先文字对比，再 goto 其中更具代表性的一件。
4. 不要编造展品清单外的物品；不知道就建议用“有什么展品”。
5. 语气像博物馆讲解员：准确、有现场感、不啰嗦。
6. 用户说“自主巡展/你自己带我逛”时返回 startTour；说“参观报告/总结一下”时返回 openReport。
7. 如果用户提到“上次/刚才/之前”，参考上下文里的参观记忆作答。
8. plan 必须和 actions 对应，不能出现没有执行的动作。
9. 打招呼或自我介绍时，必须自称“小奖”。
10. 用户问“有什么展品”时，说明馆里共有 15 件，并可简述三个展厅各有什么。
11. 用户提到具体路线名（通讯线 / 办公线 / 海边线 / 5分钟精华）时，返回 startRoute 动作。
12. 不知道答案时说“这个我暂时没找到/没听懂”，并给出可用指令，绝不编造知识库外的展品。

展品清单（id | 展厅 | 名称 | 年代 | 一句话 | 价格）：
{exhibits}
"""


def build_prompt(message, era, selected, history, memory=None):
    data = load_exhibits()
    lines = []
    for e in data.get("exhibits", []):
        lines.append(f"{e['id']} | {e['scene']} | {e['name']} | {e['year']} | {e['tagline']} | {e['price']}")
    system = SYSTEM_PROMPT.replace("{exhibits}", "\n".join(lines))
    msgs = [{"role": "system", "content": system}]
    for h in (history or [])[-6:]:
        if h.get("role") in ("user", "assistant"):
            msgs.append({"role": h["role"], "content": str(h.get("content", ""))[:500]})
    ctx = []
    if era:
        ctx.append(f"当前展厅：{era}")
    if selected:
        ex = next((e for e in data.get("exhibits", []) if e["id"] == selected), None)
        if ex:
            ctx.append(f"当前选中展品：{ex['name']}（id={ex['id']}）")
    if isinstance(memory, dict) and memory.get("visited"):
        names = [str(v.get("name", "")) for v in memory["visited"][-5:] if isinstance(v, dict)]
        if names:
            ctx.append("最近看过：" + "、".join(names))
    prefix = ("（" + "；".join(ctx) + "）") if ctx else ""
    msgs.append({"role": "user", "content": prefix + message})
    return msgs


def call_llm(cfg, messages):
    url = cfg["base"].rstrip("/") + "/chat/completions"
    body = json.dumps({"model": cfg["model"], "messages": messages, "temperature": 0.25, "max_tokens": 700}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg["key"],
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    return content


def parse_llm_json(text):
    text = (text or "").strip()
    # 去掉可能的 ```json fence
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and "reply" in obj:
            return obj
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict) and "reply" in obj:
                return obj
        except Exception:
            pass
    return {"reply": text[:500], "actions": []}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[museum] " + (fmt % args) + "\n")

    def _send_json(self, code, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            cfg = llm_config()
            return self._send_json(200, {
                "ok": True,
                "llm": bool(cfg),
                "provider": cfg["name"] if cfg else None,
                "model": cfg["model"] if cfg else None,
            })
        if self.path.split("?")[0].startswith("/api/"):
            return self._send_json(404, {"ok": False, "error": "not found"})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/chat":
            return self._send_json(404, {"ok": False, "error": "not found"})
        cfg = llm_config()
        if not cfg:
            return self._send_json(503, {"ok": False, "error": "no llm key"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            message = str(payload.get("message", ""))[:800]
            messages = build_prompt(message, payload.get("era"), payload.get("selected"),
                                    payload.get("history"), payload.get("memory"))
            raw = call_llm(cfg, messages)
            obj = parse_llm_json(raw)
            actions = obj.get("actions") or []
            if not isinstance(actions, list):
                actions = []
            plan = obj.get("plan")
            if not isinstance(plan, list):
                plan = []
            plan = [str(x)[:40] for x in plan[:5]]
            return self._send_json(200, {
                "ok": True,
                "reply": obj.get("reply", ""),
                "plan": plan,
                "actions": actions,
                "source": cfg["name"],
            })
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                pass
            return self._send_json(502, {"ok": False, "error": f"llm http {e.code}", "detail": detail})
        except Exception as e:
            return self._send_json(502, {"ok": False, "error": str(e)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    cfg = llm_config()
    print("=" * 56)
    print("数码考古馆 本地服务")
    print(f"根目录 : {ROOT}")
    print(f"地址   : http://{args.host}:{args.port}")
    print(f"大模型 : {'已配置 -> ' + cfg['name'] + ' / ' + cfg['model'] if cfg else '未配置（使用本地规则讲解，可正常演示）'}")
    print("=" * 56)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()

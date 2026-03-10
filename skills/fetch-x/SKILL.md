---
name: fetch-x
description: 获取 X/Twitter 帖子完整内容（含回复线程），自动选择最优抓取策略 | Fetch X/Twitter post content including reply threads, auto-select optimal fetching strategy
---

获取 X/Twitter 帖子内容。按以下步骤执行。

## 第一步：fxtwitter API 获取主帖（必做）

```
web_fetch: https://api.fxtwitter.com/<user>/status/<tweet_id>
```

从返回的 JSON 中提取 `tweet.text`、`tweet.author`、`tweet.created_at`。
如果用户只需要主帖内容，到此结束，保存为 MD 并发送。

## 第二步：获取回复线程（需要登录态）

X/Twitter 的回复线程**必须登录才能查看**，无法通过公开 API 获取。

### 方式 A：Chrome 扩展 browser 技能（首选）

**仅当系统提示词中没有"Chrome 浏览器扩展未连接"警告时可用。**

Step 1 — 用 `file_write` 写 batch 步骤文件：
```json
[
  {"action": "open", "args": {"url": "https://x.com/<user>/status/<tweet_id>"}},
  {"action": "sleep", "args": {"ms": 5000}},
  {"action": "scroll", "args": {"direction": "bottom"}},
  {"action": "sleep", "args": {"ms": 2000}},
  {"action": "get_content"}
]
```

Step 2 — 执行：
```
shell: node skills/browser/scripts/browser.mjs batch --file steps.json --auto-close
```

### 方式 B：browser_cdp + 已保存登录态

先检查是否有 X 的登录态：
```
browser_cdp: action=list_states
```

如果列表中有 `x-com`：
```
browser_cdp: action=load_state, name=x-com
browser_cdp: action=navigate, url=https://x.com/<user>/status/<tweet_id>
browser_cdp: action=wait, text="<主帖关键词>", timeout=10000
browser_cdp: action=scroll, direction=bottom
browser_cdp: action=wait, timeout=3000
browser_cdp: action=snapshot
```

从 snapshot 中提取作者的回复内容。

如果**没有**已保存登录态，告诉用户：
> "获取 X 回复线程需要登录态。请在 Chrome 中登录 x.com，然后让我保存登录状态（`browser_cdp: action=save_state, name=x-com`），之后就可以自动获取了。"

## 绝对不要

- ❌ `web_fetch` 抓 x.com 或 xcancel.com（前者需 JS，后者返回 403）
- ❌ `browser_cdp` 裸开 x.com（没有登录态会被登录墙拦住，拿到的是错误页面）
- ❌ 用 nitter 镜像（大多已关闭）
- ❌ `evaluate` 中用顶层 `return`（必须用 IIFE：`(function(){...})()`）
- ❌ 把大段 HTML/CSS 错误页面塞进上下文（浪费 tokens）

## 输出格式

整理为 Markdown，包含：
- 作者名 + handle + 发布时间
- 主帖正文
- 回复线程中**作者自己的回复**（按时间顺序，过滤掉其他人的回复）
- 媒体附件链接（如有）

用 `file_write` 保存为 MD 文件，然后 `send_file` 发送。

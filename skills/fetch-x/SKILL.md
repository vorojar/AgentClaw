---
name: fetch-x
description: 获取 X/Twitter 帖子完整内容（含回复线程），自动选择最优抓取策略 | Fetch X/Twitter post content including reply threads, auto-select optimal fetching strategy
---

获取 X/Twitter 帖子内容。根据需求选择最优策略。

## 策略 1：fxtwitter API（最快，仅主帖）

直接用 `web_fetch` 获取 JSON：

```
web_fetch: https://api.fxtwitter.com/<user>/status/<tweet_id>
```

返回 JSON 包含 `tweet.text`、`tweet.author`、`tweet.created_at`、`tweet.media` 等。
适用于只需要主帖内容的场景。

## 策略 2：xcancel.com 镜像（完整线程）

需要作者回复线程时，用 browser 技能打开镜像站：

Step 1 — 写 batch 步骤文件：
```json
[
  {"action": "open", "args": {"url": "https://xcancel.com/<user>/status/<tweet_id>"}},
  {"action": "sleep", "args": {"ms": 3000}},
  {"action": "get_content", "args": {"selector": ".main-thread"}}
]
```

Step 2 — 执行：
```
shell: node skills/browser/scripts/browser.mjs batch --file steps.json --auto-close
```

## 绝对不要

- ❌ `web_fetch` 抓 x.com（需要 JS 渲染，拿不到内容）
- ❌ 浏览器打开 x.com（登录墙阻拦）
- ❌ 用 syndication.twitter.com（不稳定）

## 输出格式

整理为 Markdown，包含：
- 作者名 + handle + 发布时间
- 主帖正文
- 回复线程（按时间顺序）
- 媒体附件链接（如有）

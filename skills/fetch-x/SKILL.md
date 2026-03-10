---
name: fetch-x
description: 获取 X/Twitter 帖子完整内容（含回复线程），自动选择最优抓取策略 | Fetch X/Twitter post content including reply threads, auto-select optimal fetching strategy
---

获取 X/Twitter 帖子内容。按以下步骤执行。

## 第一步：fxtwitter API 获取主帖

```
web_fetch: https://api.fxtwitter.com/<user>/status/<tweet_id>
```

返回 JSON，从中提取 `tweet.text`、`tweet.author`、`tweet.created_at`。
如果用户只需要主帖，到此结束。

## 第二步：获取完整回复线程

用户要求"包括回复线"时，必须用浏览器打开 x.com 提取。

### 方式 A：browser_cdp（首选，不依赖 Chrome 扩展）

```
browser_cdp: action=navigate, url=https://x.com/<user>/status/<tweet_id>
```

等待主帖文字出现：
```
browser_cdp: action=wait, text="主帖中的关键词"
```

向下滚动加载回复：
```
browser_cdp: action=scroll, direction=bottom
```

等待 2 秒后提取线程内容：
```
browser_cdp: action=evaluate, code=(function(){ var articles=document.querySelectorAll('article'); var result=[]; articles.forEach(function(a){ var nameEl=a.querySelector('[data-testid="User-Name"]'); var textEl=a.querySelector('[data-testid="tweetText"]'); if(textEl){ result.push({author:nameEl?nameEl.textContent.trim():'',text:textEl.textContent.trim()}); } }); return JSON.stringify(result); })()
```

**注意**：`evaluate` 的 code 必须是一个**立即执行表达式** `(function(){...})()`，不能用顶层 `return`。

### 方式 B：browser 技能（需要 Chrome 扩展已连接）

仅当系统提示词中**没有**标注"Chrome 浏览器扩展未连接"时使用：

Step 1 — 写 batch 步骤：
```json
[
  {"action": "open", "args": {"url": "https://x.com/<user>/status/<tweet_id>"}},
  {"action": "sleep", "args": {"ms": 3000}},
  {"action": "scroll", "args": {"direction": "bottom"}},
  {"action": "sleep", "args": {"ms": 2000}},
  {"action": "get_content"}
]
```

Step 2 — 执行：
```
shell: node skills/browser/scripts/browser.mjs batch --file steps.json --auto-close
```

## 绝对不要

- ❌ `web_fetch` 抓 x.com 或 xcancel.com（前者需 JS，后者返回 403）
- ❌ 用 nitter 镜像（大多已关闭）
- ❌ `evaluate` 中用顶层 `return`（Playwright 不允许，必须用 IIFE）

## 输出格式

整理为 Markdown，包含：
- 作者名 + handle + 发布时间
- 主帖正文
- 回复线程中**作者自己的回复**（按时间顺序，过滤掉其他人的回复）
- 媒体附件链接（如有）

用 `file_write` 保存为 MD 文件，然后 `send_file` 发送。

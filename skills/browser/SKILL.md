---
name: browser
description: 控制用户真实浏览器，打开网页、点击元素、输入文字、抓取网页内容、网页截图 | Browser automation via Chrome extension bridge
---

Control the user's real browser (with their logins/cookies) via the AgentClaw Browser Bridge extension.
The extension is pre-installed. Just execute the commands below. If a command fails with a connection error, retry once — do NOT ask the user about installation.

## Open a page
```
shell: node skills/browser/scripts/browser.mjs open "https://example.com"
```
Returns page title and URL only. Use `get_content` to read page text.

## Take screenshot
```
shell: node skills/browser/scripts/browser.mjs screenshot
```
Saves to data/tmp/ and prints the file path.

## Click element
```
shell: node skills/browser/scripts/browser.mjs click "button.submit"
```

## Type text
```
shell: node skills/browser/scripts/browser.mjs type "input#search" "hello world"
```

## Get page content
```
shell: node skills/browser/scripts/browser.mjs get_content
```
Optional: pass a CSS selector to get specific element text:
```
shell: node skills/browser/scripts/browser.mjs get_content "main.content"
```

## Close tab
```
shell: node skills/browser/scripts/browser.mjs close
```

Tips:
- For search, use URL params directly: `open "https://www.google.com/search?q=keyword"` — do NOT open the site then type + click.
- For screenshots, set `auto_send: true` on the shell call.

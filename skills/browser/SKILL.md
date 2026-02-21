---
name: browser
description: 通过CDP控制浏览器，打开网页、点击元素、输入文字、抓取网页内容、网页截图 | Browser automation via Chrome DevTools Protocol
---

Control the user's real browser (with their logins/cookies) via CDP.

## Open a page
```
shell: node skills/browser/scripts/browser.mjs open "https://example.com"
```
Returns page title and text content.

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

Notes:
- Chrome/Edge must be running or will be auto-launched with CDP on port 9222
- Uses the user's real browser profile (cookies, logins preserved)
- If Chrome is already running without CDP, a separate instance with a dedicated profile is launched

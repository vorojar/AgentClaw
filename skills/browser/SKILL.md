---
name: browser
description: 控制用户真实浏览器，打开网页、点击元素、输入文字、抓取网页内容、网页截图 | Browser automation via Chrome extension bridge
---

Control the user's real browser (with their logins/cookies) via the AgentClaw Browser Bridge extension.
The extension is pre-installed. Just execute the commands below. If a command fails with a connection error, retry once — do NOT ask the user about installation.

## Batch mode (preferred — all steps in one call, much faster)

```
shell: node skills/browser/scripts/browser.mjs batch '<JSON array>'
```

Each step: `{"action": "open|click|type|screenshot|get_content|wait_for|sleep|close", "args": {...}}`

In batch mode, **click/type auto-wait** for the selector to appear (up to 5s), so you don't need explicit wait_for before them.

### Example: Post on X/Twitter
```
{"command": "node skills/browser/scripts/browser.mjs batch '[{\"action\":\"open\",\"args\":{\"url\":\"https://x.com\"}},{\"action\":\"click\",\"args\":{\"selector\":\"[data-testid=tweetTextarea_0]\"}},{\"action\":\"type\",\"args\":{\"selector\":\"[data-testid=tweetTextarea_0]\",\"text\":\"Hello world!\"}},{\"action\":\"click\",\"args\":{\"selector\":\"[data-testid=tweetButtonInline]\",\"timeout\":10000}},{\"action\":\"sleep\",\"args\":{\"ms\":2000}},{\"action\":\"screenshot\"}]'", "timeout": 30000, "auto_send": true}
```
Note: Home page uses `tweetButtonInline`; compose page (`/compose/post`) uses `tweetButton`. For buttons, auto-wait also checks the button is not disabled (e.g. waiting for URL preview to load).

### Example: Search Google and get content
```
{"command": "node skills/browser/scripts/browser.mjs batch '[{\"action\":\"open\",\"args\":{\"url\":\"https://www.google.com/search?q=test\"}},{\"action\":\"get_content\",\"args\":{\"selector\":\"#search\"}}]'", "timeout": 20000}
```

### Step reference
| action | args | description |
|---|---|---|
| open | `{"url": "..."}` | Open URL in new tab, wait for load |
| click | `{"selector": "..."}` | Click element |
| type | `{"selector": "...", "text": "..."}` | Type text (supports contentEditable) |
| get_content | `{"selector": "..."}` (optional) | Get page/element text |
| screenshot | (none) | Capture visible tab |
| wait_for | `{"selector": "...", "timeout": 5000}` | Wait for element to appear |
| sleep | `{"ms": 1000}` | Wait fixed time |
| close | (none) | Close current tab |

## Single commands (for debugging or one-off actions)

### Search
```
{"command": "node skills/browser/scripts/browser.mjs search \"keyword\"", "timeout": 15000}
```

### Open + Screenshot
```
{"command": "node skills/browser/scripts/browser.mjs open \"https://example.com\"", "timeout": 15000}
{"command": "node skills/browser/scripts/browser.mjs screenshot", "auto_send": true, "timeout": 15000}
```

### Get page content
```
{"command": "node skills/browser/scripts/browser.mjs get_content", "timeout": 15000}
{"command": "node skills/browser/scripts/browser.mjs get_content \"main.content\"", "timeout": 15000}
```

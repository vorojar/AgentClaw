---
name: browser
description: "[旧版] 通过 Chrome 扩展操控浏览器。推荐改用 agent-browser 技能（自动连接 Chrome CDP，无需扩展） | [Legacy] Browser via extension. Prefer agent-browser skill (auto CDP, no extension needed)"
---

Control the user's real browser (with their logins/cookies) via the AgentClaw Browser Bridge extension.
The extension is pre-installed. Just execute the commands below. If a command fails with a connection error, retry once — do NOT ask the user about installation.

## Batch mode (preferred — all steps in one call, much faster)

**IMPORTANT: Always use `--file` mode to avoid shell quoting issues.**

Step 1 — Write steps to a JSON file using `file_write`:
```json
[
  {"action": "open", "args": {"url": "https://x.com/compose/post"}},
  {"action": "type", "args": {"selector": "[data-testid=tweetTextarea_0]", "text": "Hello!"}},
  {"action": "click", "args": {"selector": "[data-testid=tweetButton]"}},
  {"action": "sleep", "args": {"ms": 2000}},
  {"action": "screenshot"}
]
```

Step 2 — Execute:
```
shell: node skills/browser/scripts/browser.mjs batch --file steps.json --auto-close
```

Each step: `{"action": "open|click|type|scroll|screenshot|get_content|wait_for|sleep|close|save_login", "args": {...}}`

In batch mode, **click/type auto-wait** for the selector to appear (up to 5s), so you don't need explicit wait_for before them.

`--auto-close`: automatically close the tab when batch completes (recommended for scheduled tasks).

### Example: Post on X/Twitter
```
{"command": "node skills/browser/scripts/browser.mjs batch '[{\"action\":\"open\",\"args\":{\"url\":\"https://x.com\"}},{\"action\":\"click\",\"args\":{\"selector\":\"[data-testid=tweetTextarea_0]\"}},{\"action\":\"type\",\"args\":{\"selector\":\"[data-testid=tweetTextarea_0]\",\"text\":\"Hello world!\"}},{\"action\":\"click\",\"args\":{\"selector\":\"[data-testid=tweetButtonInline]\",\"timeout\":10000}},{\"action\":\"sleep\",\"args\":{\"ms\":2000}},{\"action\":\"screenshot\"}]'", "timeout": 30000, "auto_send": true}
```
Note: Home page uses `tweetButtonInline`; compose page (`/compose/post`) uses `tweetButton`. For buttons, auto-wait also checks the button is not disabled (e.g. waiting for URL preview to load).

### Example: Reply to first tweet on X/Twitter
Step 1 — get first tweet content:
```
{"command": "node skills/browser/scripts/browser.mjs batch '[{\"action\":\"open\",\"args\":{\"url\":\"https://x.com\"}},{\"action\":\"get_content\",\"args\":{\"selector\":\"[data-testid=tweetText]\"}}]'", "timeout": 20000}
```
Step 2 — compose and send reply (use the content from step 1 to craft your reply):
```
{"command": "node skills/browser/scripts/browser.mjs batch '[{\"action\":\"click\",\"args\":{\"selector\":\"[data-testid=reply]\"}},{\"action\":\"type\",\"args\":{\"selector\":\"[data-testid=tweetTextarea_0]\",\"text\":\"Your reply here\"}},{\"action\":\"click\",\"args\":{\"selector\":\"[data-testid=tweetButton]\",\"timeout\":10000}},{\"action\":\"sleep\",\"args\":{\"ms\":2000}},{\"action\":\"screenshot\"}]'", "timeout": 30000, "auto_send": true}
```
Note: `querySelector` returns the first match, so `[data-testid=reply]` targets the first tweet's reply button — do NOT use `:first` (jQuery-only, invalid in CSS). Reply modal uses `tweetButton` (not `tweetButtonInline`).

### Example: Scroll and read lazy-loaded content (Zhihu, etc.)
```
{"command": "node skills/browser/scripts/browser.mjs batch '[{\"action\":\"open\",\"args\":{\"url\":\"https://zhuanlan.zhihu.com/p/123456\"}},{\"action\":\"scroll\",\"args\":{\"direction\":\"bottom\"}},{\"action\":\"sleep\",\"args\":{\"ms\":1500}},{\"action\":\"get_content\",\"args\":{\"selector\":\"article\"}}]'", "timeout": 30000}
```
For very long pages, scroll multiple times with sleep between each scroll to trigger lazy loading.

### Example: Search Google and get content
```
{"command": "node skills/browser/scripts/browser.mjs batch '[{\"action\":\"open\",\"args\":{\"url\":\"https://www.google.com/search?q=test\"}},{\"action\":\"get_content\",\"args\":{\"selector\":\"#search\"}}]'", "timeout": 20000}
```

### Step reference
| action | args | description |
|---|---|---|
| open | `{"url": "..."}` | Open URL in new tab, wait for load |
| click | `{"selector": "e5", "human": true}` | Click element. `human`: simulate mouse movement + random delay |
| type | `{"selector": "e3", "text": "...", "human": true}` | Type text. `human`: individual keystrokes with 30-150ms random delay |
| scroll | `{"direction": "down"}` | Scroll page: down/up/top/bottom, optional `pixels` and `selector` |
| get_content | `{"selector": "...", "filter": "interactive"}` | Snapshot. `filter: "interactive"`: only buttons/links/inputs (~80% fewer tokens) |
| screenshot | (none) | Capture visible tab |
| wait_for | `{"selector": "...", "timeout": 5000}` | Wait for element to appear |
| sleep | `{"ms": 1000}` | Wait fixed time |
| close | (none) | Close current tab |
| save_login | `{"name": "xiaohongshu"}` | Save cookies + localStorage for Playwright reuse |

### Anti-detection options
- **`human: true`** on click/type: simulates human behavior (random delays, mouse events). **Use on social media** (小红书、微博、抖音) to avoid bot detection.
- **`filter: "interactive"`** on get_content: returns only clickable/typeable elements, skipping page text. Saves ~80% tokens when you just need to find a button.
- **`summary: true`** on batch: intermediate steps return only pass/fail, last step returns full result. Saves tokens for long batch sequences.

### Accessibility Snapshot (get_content)

`get_content` returns a token-efficient accessibility snapshot instead of raw text:
- Interactive elements are tagged with ref IDs: `[e1] button "Submit"`, `[e2] link "Home" → /`
- Headings use markdown format: `# Title`, `## Subtitle`
- Regular text content is preserved inline
- Use ref IDs directly in `click`/`type` selectors: `{"selector": "e5"}` — no CSS needed

Example snapshot output:
```
# Search Results

[e1] input[text] "Search..."
[e2] button "Search"

## First Result
Some result text here
[e3] link "View details" → /result/1

[e4] button "Next Page"
```

Workflow: `get_content` → read snapshot → `click`/`type` with ref IDs (e.g. `e3`). CSS selectors still work for all actions.

## Save & restore login state

Save the current page's login session (cookies + localStorage) so it can be reused later by Playwright for unattended automation.

### Save login (on a page where you're already logged in)
```
{"command": "node skills/browser/scripts/browser.mjs save_login xiaohongshu", "timeout": 10000}
```
This exports cookies + localStorage from the active tab and saves to `data/browser-states/xiaohongshu.json` in Playwright storageState format.

### List saved logins
```
{"command": "node skills/browser/scripts/browser.mjs list_logins", "timeout": 5000}
```

### Use saved login with browser_cdp tool
After saving, the `browser_cdp` tool can load the state via `load_state` action to launch a Playwright browser with the saved login session — no manual login needed.

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

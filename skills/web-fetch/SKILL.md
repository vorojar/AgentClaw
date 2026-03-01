---
name: web-fetch
description: 抓取和读取网页内容，支持 JS 渲染页面 | Fetch and extract text content from web pages with JS rendering support
---

## Decision: curl vs Playwright

Use **curl** when ANY of these is true:
- URL points to an API endpoint (`/api/`, `.json`, `.xml`, `.csv`, `.txt`)
- URL is localhost / 127.0.0.1 / internal service
- User explicitly asks for raw JSON or API response
- URL pattern is clearly a REST API (contains query params like `api_key`, `token`, `format=json`)

Use **Playwright** for everything else (normal web pages that humans read in a browser).

## Step 0: Install Playwright dependencies (first time only, skip for curl)

```json
{"command": "pip install playwright markdownify && python -m playwright install chromium --with-deps", "timeout": 120000}
```

---

## A. curl — API / JSON / lightweight

```json
{"command": "curl -s -L \"URL\"", "timeout": 30000}
```

For pretty-printed JSON:
```json
{"command": "curl -s -L \"URL\" | python -m json.tool", "timeout": 30000}
```

## B. Playwright — normal web pages

Default (JS rendered, markdown output):
```json
{"command": "python skills/web-fetch/scripts/fetch.py --url \"URL\"", "timeout": 60000}
```

With scroll (lazy-loaded content — Zhihu, Twitter, news sites, infinite scroll):
```json
{"command": "python skills/web-fetch/scripts/fetch.py --url \"URL\" --scroll", "timeout": 90000}
```

Custom max length:
```json
{"command": "python skills/web-fetch/scripts/fetch.py --url \"URL\" --max-length 20000", "timeout": 60000}
```

Raw HTML:
```json
{"command": "python skills/web-fetch/scripts/fetch.py --url \"URL\" --raw", "timeout": 60000}
```

## Error handling

- If fetch.py fails, report the error to the user. Do NOT fall back to curl for web pages — curl cannot render JS.
- Do NOT use `find` or `locate` to search for scripts. The path is fixed: `skills/web-fetch/scripts/fetch.py`.
- Do NOT switch to browser skill as fallback. This skill is self-contained.

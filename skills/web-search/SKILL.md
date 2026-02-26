---
name: web-search
description: 搜索互联网信息，查找最新资讯、知识问答 | Search the web for information via SearXNG/Google
---

When the user asks to search the web, use the search script:

```
shell: python skills/web-search/scripts/search.py "search query"
```

Optional: limit results count (default 5):
```
shell: python skills/web-search/scripts/search.py "search query" --max 3
```

The script uses SearXNG (self-hosted, free) as primary search engine.
If SearXNG is unavailable, it falls back to Serper API (requires SERPER_API_KEY).
Configure SearXNG URL via SEARXNG_URL environment variable (default: http://localhost:8888).

---
name: web-search
description: Search the web via Google
triggers:
  - type: keyword
    patterns: ["搜索", "search", "查询", "google", "查一下", "搜一下", "找一下", "look up", "百度"]
---

When the user asks to search the web, use the search script:

```
shell: python skills/web-search/scripts/search.py "search query"
```

Optional: limit results count (default 5):
```
shell: python skills/web-search/scripts/search.py "search query" --max 3
```

The script requires SERPER_API_KEY environment variable to be set.
It returns formatted search results with titles, URLs, and snippets.

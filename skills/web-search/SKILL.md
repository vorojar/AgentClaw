---
name: web-search
description: 搜索互联网信息，查找最新资讯、知识问答 | Search the web for information via Google
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

---
name: web-fetch
description: Fetch and read web page content
triggers:
  - type: keyword
    patterns: ["网页", "抓取", "爬取", "fetch", "读取网页", "页面内容", "URL内容"]
---

When the user wants to read web page content, use curl + text extraction via shell:

Fetch raw HTML:
```
shell: curl -s -L "https://example.com"
```

Fetch and extract text (remove HTML tags):
```
shell: curl -s -L "https://example.com" | python3 -c "
import sys, re
html = sys.stdin.read()
# Remove script/style
html = re.sub(r'<script[\s\S]*?</script>', '', html, flags=re.I)
html = re.sub(r'<style[\s\S]*?</style>', '', html, flags=re.I)
# Strip tags
text = re.sub(r'<[^>]+>', '\n', html)
# Decode entities
text = text.replace('&amp;','&').replace('&lt;','<').replace('&gt;','>').replace('&nbsp;',' ')
# Collapse whitespace
lines = [l.strip() for l in text.split('\n') if l.strip()]
print('\n'.join(lines[:200]))
"
```

Tips:
- Use `-L` to follow redirects
- Use `-A "Mozilla/5.0"` if the site blocks bots
- For JSON APIs, use `curl -s URL | python3 -m json.tool`
- Truncate output if too long to avoid token waste

---
name: http-request
description: Send HTTP requests via curl
triggers:
  - type: keyword
    patterns: ["curl", "http请求", "API调用", "POST请求", "GET请求", "REST", "接口"]
---

When the user needs to make HTTP requests, use curl via shell:

Basic GET:
```
shell: curl -s https://api.example.com/data
```

POST with JSON body:
```
shell: curl -s -X POST https://api.example.com/data -H "Content-Type: application/json" -d '{"key":"value"}'
```

With headers:
```
shell: curl -s -H "Authorization: Bearer TOKEN" https://api.example.com/data
```

Tips:
- Use `-s` (silent) to suppress progress bar
- Use `-w "\n%{http_code}"` to get status code
- Use `| python -m json.tool` to pretty-print JSON
- For file uploads: `curl -F "file=@path/to/file" URL`
- For timeout: `curl --connect-timeout 10 -m 30 URL`

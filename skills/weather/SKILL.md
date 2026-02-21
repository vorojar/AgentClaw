---
name: weather
description: 查询天气预报，获取气温、降雨、风力等信息 | Query weather forecasts
---

Use wttr.in to query weather. The user's city is already known from context or previous conversations. If unknown, ask.

## Today's weather (one-line)
```
shell: curl -s "wttr.in/Ningbo?format=3"
```

## Full 3-day forecast (default — use this for "明天"/"后天"/"这周" questions)
```
shell: curl -s "wttr.in/Ningbo?lang=zh"
```

## Specific day
Just use the full 3-day forecast and extract the relevant day from the output.

## Rules
- City name MUST be in English (Ningbo, Shanghai, Beijing, etc.). Chinese city names cause encoding issues.
- Always use bash (default shell), NEVER PowerShell for curl.
- The current date is already in the system prompt — do NOT run a shell command to get the date.
- One curl call is enough. Do NOT make multiple attempts.

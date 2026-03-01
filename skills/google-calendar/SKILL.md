---
name: google-calendar
description: 管理Google日历，查看日程、创建会议、修改和删除事件 | Manage Google Calendar events (list, create, update, delete)
---

Requires env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

## List events (default: next 7 days)
```json
{"command": "python skills/google-calendar/scripts/gcal.py list", "timeout": 30000}
```

## List events (custom range)
```json
{"command": "python skills/google-calendar/scripts/gcal.py list --from '2025-03-01T00:00:00Z' --to '2025-03-07T23:59:59Z'", "timeout": 30000}
```

## Search events
```json
{"command": "python skills/google-calendar/scripts/gcal.py list --query 'keyword'", "timeout": 30000}
```

## Create event
```json
{"command": "python skills/google-calendar/scripts/gcal.py create --summary 'Meeting' --start '2025-03-01T14:00:00+08:00' --end '2025-03-01T15:00:00+08:00'", "timeout": 30000}
```
Optional: `--description 'notes'`, `--reminder 10` (minutes)

## Create all-day event
```json
{"command": "python skills/google-calendar/scripts/gcal.py create --summary 'Holiday' --start '2025-03-01' --all-day", "timeout": 30000}
```

## Delete event
```json
{"command": "python skills/google-calendar/scripts/gcal.py delete --event-id 'EVENT_ID'", "timeout": 30000}
```

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- Time format: ISO 8601 with timezone (e.g., `2025-03-01T14:00:00+08:00`).
- List events first to get event IDs before deleting.
- One command per action. Do NOT batch multiple operations.

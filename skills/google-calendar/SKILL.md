---
name: google-calendar
description: 管理Google日历，查看日程、创建会议、修改和删除事件 | Manage Google Calendar events (list, create, update, delete)
---

Use the Google Calendar script to manage events:

## List events (default: next 7 days)
```
shell: python skills/google-calendar/scripts/gcal.py list
```
Custom range:
```
shell: python skills/google-calendar/scripts/gcal.py list --from "2025-03-01T00:00:00Z" --to "2025-03-07T23:59:59Z"
```
Search:
```
shell: python skills/google-calendar/scripts/gcal.py list --query "meeting"
```

## Create event
```
shell: python skills/google-calendar/scripts/gcal.py create --summary "Team Meeting" --start "2025-03-01T14:00:00+08:00" --end "2025-03-01T15:00:00+08:00"
```
All-day event:
```
shell: python skills/google-calendar/scripts/gcal.py create --summary "Holiday" --start "2025-03-01" --all-day
```
Optional: `--description "notes"`, `--reminder 10` (minutes)

## Delete event
```
shell: python skills/google-calendar/scripts/gcal.py delete --event-id "abc123"
```

Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

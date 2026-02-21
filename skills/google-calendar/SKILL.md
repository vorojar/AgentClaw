---
name: google-calendar
description: Manage Google Calendar events
triggers:
  - type: keyword
    patterns: ["日历", "日程", "calendar", "事件", "会议", "约会", "schedule", "appointment", "今天有什么", "明天安排"]
---

Use the Google Calendar script to manage events:

## List events (default: next 7 days)
```
shell: python3 skills/google-calendar/scripts/gcal.py list
```
Custom range:
```
shell: python3 skills/google-calendar/scripts/gcal.py list --from "2025-03-01T00:00:00Z" --to "2025-03-07T23:59:59Z"
```
Search:
```
shell: python3 skills/google-calendar/scripts/gcal.py list --query "meeting"
```

## Create event
```
shell: python3 skills/google-calendar/scripts/gcal.py create --summary "Team Meeting" --start "2025-03-01T14:00:00+08:00" --end "2025-03-01T15:00:00+08:00"
```
All-day event:
```
shell: python3 skills/google-calendar/scripts/gcal.py create --summary "Holiday" --start "2025-03-01" --all-day
```
Optional: `--description "notes"`, `--reminder 10` (minutes)

## Delete event
```
shell: python3 skills/google-calendar/scripts/gcal.py delete --event-id "abc123"
```

Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

---
name: gws-calendar
description: Google日历管理——查看日程、创建/修改/删除事件 | Google Calendar via gws CLI (list, create, update, delete events)
---

Requires: `gws` CLI installed and authenticated (`gws auth login`).

## Command syntax

```
gws calendar <resource> <method> --params '{"key":"val"}' --json '{"key":"val"}'
```

- `--params` = URL/query parameters (calendarId, timeMin, timeMax, etc.)
- `--json` = request body (event data)
- All output is JSON. Use `--dry-run` to preview without executing.

## List upcoming events (next 7 days)

```json
{"command": "gws calendar events list --params '{\"calendarId\":\"primary\",\"timeMin\":\"2026-03-05T00:00:00Z\",\"timeMax\":\"2026-03-12T23:59:59Z\",\"singleEvents\":true,\"orderBy\":\"startTime\",\"maxResults\":20}'", "timeout": 30000}
```

## Get a specific event

```json
{"command": "gws calendar events get --params '{\"calendarId\":\"primary\",\"eventId\":\"EVENT_ID\"}'", "timeout": 30000}
```

## Create event

```json
{"command": "gws calendar events insert --params '{\"calendarId\":\"primary\"}' --json '{\"summary\":\"Meeting\",\"start\":{\"dateTime\":\"2026-03-06T14:00:00+08:00\"},\"end\":{\"dateTime\":\"2026-03-06T15:00:00+08:00\"},\"description\":\"Notes here\"}'", "timeout": 30000}
```

## Create all-day event

```json
{"command": "gws calendar events insert --params '{\"calendarId\":\"primary\"}' --json '{\"summary\":\"Holiday\",\"start\":{\"date\":\"2026-03-06\"},\"end\":{\"date\":\"2026-03-07\"}}'", "timeout": 30000}
```

## Quick add (natural language)

```json
{"command": "gws calendar events quickAdd --params '{\"calendarId\":\"primary\",\"text\":\"Lunch with Alice tomorrow at noon\"}'", "timeout": 30000}
```

## Update event

```json
{"command": "gws calendar events patch --params '{\"calendarId\":\"primary\",\"eventId\":\"EVENT_ID\"}' --json '{\"summary\":\"Updated title\"}'", "timeout": 30000}
```

## Delete event

```json
{"command": "gws calendar events delete --params '{\"calendarId\":\"primary\",\"eventId\":\"EVENT_ID\"}'", "timeout": 30000}
```

## List calendars

```json
{"command": "gws calendar calendarList list", "timeout": 30000}
```

## Discover parameters for any method

```json
{"command": "gws schema calendar.events.list", "timeout": 15000}
```

## Rules
- calendarId is always required. Use `"primary"` for the user's main calendar.
- Time format: RFC 3339 (e.g., `2026-03-06T14:00:00+08:00` or `2026-03-06T14:00:00Z`).
- For date-only (all-day): use `date` field, not `dateTime`.
- Set `singleEvents: true` + `orderBy: startTime` when listing to expand recurring events.
- List events first to get eventId before updating or deleting.
- Use `gws schema <method>` to discover parameters you're unsure about.

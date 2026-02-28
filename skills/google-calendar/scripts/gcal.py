#!/usr/bin/env python3
"""Google Calendar management."""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

TOKEN_URL = "https://oauth2.googleapis.com/token"
CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

_cached_token = None
_token_expiry = 0


def get_access_token():
    global _cached_token, _token_expiry
    import time
    if _cached_token and time.time() < _token_expiry - 60:
        return _cached_token

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
    if not all([client_id, client_secret, refresh_token]):
        print("Error: Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN", file=sys.stderr)
        sys.exit(1)

    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"Token refresh failed ({e.code} {e.reason}):\n{body}", file=sys.stderr)
        sys.exit(1)
    _cached_token = result["access_token"]
    _token_expiry = time.time() + result.get("expires_in", 3600)
    return _cached_token


def google_request(url, method="GET", body=None):
    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    else:
        data = None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"API error ({e.code}): {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


def format_event(event, index=None):
    title = event.get("summary", "(无标题)")
    prefix = f"{index}. " if index else "• "
    lines = [f"{prefix}{title}"]

    start = event.get("start", {})
    end = event.get("end", {})
    if start.get("date"):
        end_date = end.get("date", start["date"])
        time_str = f"全天 {start['date']}" if start["date"] == end_date else f"全天 {start['date']} ~ {end_date}"
    elif start.get("dateTime"):
        s = start["dateTime"][:16].replace("T", " ")
        e = end.get("dateTime", "")[:16].replace("T", " ") if end.get("dateTime") else ""
        time_str = f"{s} ~ {e}" if e else s
    else:
        time_str = "(未知时间)"

    lines.append(f"  时间：{time_str}")
    lines.append(f"  ID：{event.get('id', '')}")
    return "\n".join(lines)


def cmd_list(args):
    import urllib.parse
    now = datetime.now(timezone.utc).isoformat()
    time_min = args.time_from or now
    time_max = args.time_to or (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

    params = urllib.parse.urlencode({
        "timeMin": time_min, "timeMax": time_max,
        "singleEvents": "true", "orderBy": "startTime", "maxResults": "20",
        **({"q": args.query} if args.query else {}),
    })
    data = google_request(f"{CAL_BASE}?{params}")
    items = data.get("items", [])
    if not items:
        print("在指定时间范围内没有找到任何日历事件。")
        return
    print(f"共找到 {len(items)} 个事件：\n")
    for i, event in enumerate(items, 1):
        print(format_event(event, i))
        print()


def cmd_create(args):
    if not args.summary:
        print("Error: --summary is required", file=sys.stderr)
        sys.exit(1)
    if not args.start:
        print("Error: --start is required", file=sys.stderr)
        sys.exit(1)

    body = {"summary": args.summary}
    if args.description:
        body["description"] = args.description

    if args.all_day:
        start_date = args.start[:10]
        if args.end:
            end_date = args.end[:10]
        else:
            from datetime import date
            d = date.fromisoformat(start_date)
            end_date = (d + timedelta(days=1)).isoformat()
        body["start"] = {"date": start_date}
        body["end"] = {"date": end_date}
    else:
        body["start"] = {"dateTime": args.start}
        end_time = args.end
        if not end_time:
            dt = datetime.fromisoformat(args.start)
            end_time = (dt + timedelta(hours=1)).isoformat()
        body["end"] = {"dateTime": end_time}

    reminder = args.reminder if args.reminder is not None else 10
    body["reminders"] = {"useDefault": False, "overrides": [{"method": "popup", "minutes": reminder}]}

    result = google_request(CAL_BASE, method="POST", body=body)
    print(f"事件创建成功！\n{format_event(result)}")


def cmd_delete(args):
    if not args.event_id:
        print("Error: --event-id is required", file=sys.stderr)
        sys.exit(1)
    import urllib.parse
    url = f"{CAL_BASE}/{urllib.parse.quote(args.event_id)}"
    google_request(url, method="DELETE")
    print(f"事件 \"{args.event_id}\" 已成功删除。")


def main():
    parser = argparse.ArgumentParser(description="Google Calendar management")
    sub = parser.add_subparsers(dest="action", required=True)

    ls = sub.add_parser("list")
    ls.add_argument("--from", dest="time_from")
    ls.add_argument("--to", dest="time_to")
    ls.add_argument("--query")

    cr = sub.add_parser("create")
    cr.add_argument("--summary", required=True)
    cr.add_argument("--start", required=True)
    cr.add_argument("--end")
    cr.add_argument("--description")
    cr.add_argument("--all-day", action="store_true")
    cr.add_argument("--reminder", type=int)

    dl = sub.add_parser("delete")
    dl.add_argument("--event-id", required=True)

    args = parser.parse_args()
    {"list": cmd_list, "create": cmd_create, "delete": cmd_delete}[args.action](args)


if __name__ == "__main__":
    main()

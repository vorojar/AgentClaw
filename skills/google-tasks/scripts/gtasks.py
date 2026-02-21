#!/usr/bin/env python3
"""Google Tasks management."""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

TOKEN_URL = "https://oauth2.googleapis.com/token"
TASKS_BASE = "https://tasks.googleapis.com/tasks/v1"

_cached_token = None
_token_expiry = 0


def get_access_token():
    global _cached_token, _token_expiry
    if _cached_token and time.time() < _token_expiry - 60:
        return _cached_token

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
    if not all([client_id, client_secret, refresh_token]):
        print("Error: Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN", file=sys.stderr)
        sys.exit(1)

    data = urllib.parse.urlencode({
        "client_id": client_id, "client_secret": client_secret,
        "refresh_token": refresh_token, "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
    _cached_token = result["access_token"]
    _token_expiry = time.time() + result.get("expires_in", 3600)
    return _cached_token


def api_request(url, method="GET", body=None):
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


def format_task(task, index):
    status = "已完成" if task.get("status") == "completed" else "待办"
    lines = [f"{index}. {task.get('title', '')}"]
    if task.get("due"):
        lines.append(f"   截止日期：{task['due'][:10]}")
    lines.append(f"   状态：{status}")
    lines.append(f"   ID：{task.get('id', '')}")
    if task.get("notes"):
        lines.append(f"   备注：{task['notes']}")
    return "\n".join(lines)


def cmd_list(args):
    task_list = args.list or "@default"
    encoded = urllib.parse.quote(task_list)
    url = f"{TASKS_BASE}/lists/{encoded}/tasks?showCompleted=false&maxResults=50"
    data = api_request(url)
    items = data.get("items", [])
    if not items:
        print("当前任务列表为空，没有待办任务。")
        return
    print(f"任务列表（{task_list}）共 {len(items)} 条待办任务：\n")
    for i, task in enumerate(items, 1):
        print(format_task(task, i))
        print()


def cmd_create(args):
    if not args.title:
        print("Error: --title is required", file=sys.stderr)
        sys.exit(1)
    task_list = args.list or "@default"
    encoded = urllib.parse.quote(task_list)
    body = {"title": args.title}
    if args.notes:
        body["notes"] = args.notes
    if args.due:
        body["due"] = args.due
    url = f"{TASKS_BASE}/lists/{encoded}/tasks"
    result = api_request(url, method="POST", body=body)
    print(f"任务创建成功！\n{format_task(result, 1)}")


def cmd_complete(args):
    if not args.task_id:
        print("Error: --task-id is required", file=sys.stderr)
        sys.exit(1)
    task_list = args.list or "@default"
    encoded_list = urllib.parse.quote(task_list)
    encoded_id = urllib.parse.quote(args.task_id)
    url = f"{TASKS_BASE}/lists/{encoded_list}/tasks/{encoded_id}"
    result = api_request(url, method="PATCH", body={"status": "completed"})
    print(f"任务「{result.get('title', '')}」已标记为完成。")


def cmd_delete(args):
    if not args.task_id:
        print("Error: --task-id is required", file=sys.stderr)
        sys.exit(1)
    task_list = args.list or "@default"
    encoded_list = urllib.parse.quote(task_list)
    encoded_id = urllib.parse.quote(args.task_id)
    url = f"{TASKS_BASE}/lists/{encoded_list}/tasks/{encoded_id}"
    api_request(url, method="DELETE")
    print(f"任务（ID：{args.task_id}）已成功删除。")


def main():
    parser = argparse.ArgumentParser(description="Google Tasks management")
    parser.add_argument("--list", default="@default", help="Task list ID")
    sub = parser.add_subparsers(dest="action", required=True)

    sub.add_parser("list")

    cr = sub.add_parser("create")
    cr.add_argument("--title", required=True)
    cr.add_argument("--notes")
    cr.add_argument("--due")

    comp = sub.add_parser("complete")
    comp.add_argument("--task-id", required=True)

    dl = sub.add_parser("delete")
    dl.add_argument("--task-id", required=True)

    args = parser.parse_args()
    {"list": cmd_list, "create": cmd_create, "complete": cmd_complete, "delete": cmd_delete}[args.action](args)


if __name__ == "__main__":
    main()

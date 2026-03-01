---
name: google-tasks
description: 管理Google Tasks待办事项，创建、完成、删除任务 | Manage Google Tasks (create, complete, delete to-do items)
---

Requires env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

## List tasks
```json
{"command": "python skills/google-tasks/scripts/gtasks.py list", "timeout": 30000}
```

## Create task
```json
{"command": "python skills/google-tasks/scripts/gtasks.py create --title 'Task title'", "timeout": 30000}
```
Optional: `--notes 'details'`, `--due '2025-03-01'`

## Complete task
```json
{"command": "python skills/google-tasks/scripts/gtasks.py complete --task-id 'TASK_ID'", "timeout": 30000}
```

## Delete task
```json
{"command": "python skills/google-tasks/scripts/gtasks.py delete --task-id 'TASK_ID'", "timeout": 30000}
```

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- List tasks first to get task IDs before completing or deleting.
- One command per action. Do NOT batch multiple operations.

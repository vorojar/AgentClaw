---
name: google-tasks
description: 管理Google Tasks待办事项，创建、完成、删除任务 | Manage Google Tasks (create, complete, delete to-do items)
---

Use the Google Tasks script to manage tasks:

## List tasks
```
shell: python skills/google-tasks/scripts/gtasks.py list
```

## Create task
```
shell: python skills/google-tasks/scripts/gtasks.py create --title "Buy groceries"
```
Optional: `--notes "details"`, `--due "2025-03-01"`

## Complete task
```
shell: python skills/google-tasks/scripts/gtasks.py complete --task-id "abc123"
```

## Delete task
```
shell: python skills/google-tasks/scripts/gtasks.py delete --task-id "abc123"
```

Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

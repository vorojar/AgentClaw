---
name: gws-tasks
description: Google Tasks待办管理——查看、创建、完成、删除任务 | Google Tasks via gws CLI (list, create, complete, delete)
---

Requires: `gws` CLI installed and authenticated (`gws auth login`).

## Command syntax

```
gws tasks <resource> <method> --params '{"key":"val"}' --json '{"key":"val"}'
```

## List task lists

```json
{"command": "gws tasks tasklists list", "timeout": 30000}
```

## List tasks in a task list

```json
{"command": "gws tasks tasks list --params '{\"tasklist\":\"TASKLIST_ID\",\"showCompleted\":false}'", "timeout": 30000}
```

Use `@default` as tasklist ID for the default list.

## Create task

```json
{"command": "gws tasks tasks insert --params '{\"tasklist\":\"@default\"}' --json '{\"title\":\"Buy groceries\",\"notes\":\"Milk, eggs, bread\",\"due\":\"2026-03-07T00:00:00Z\"}'", "timeout": 30000}
```

## Complete task

```json
{"command": "gws tasks tasks patch --params '{\"tasklist\":\"@default\",\"task\":\"TASK_ID\"}' --json '{\"status\":\"completed\"}'", "timeout": 30000}
```

## Update task

```json
{"command": "gws tasks tasks patch --params '{\"tasklist\":\"@default\",\"task\":\"TASK_ID\"}' --json '{\"title\":\"Updated title\",\"notes\":\"New notes\"}'", "timeout": 30000}
```

## Delete task

```json
{"command": "gws tasks tasks delete --params '{\"tasklist\":\"@default\",\"task\":\"TASK_ID\"}'", "timeout": 30000}
```

## Rules
- List task lists first to get tasklist IDs. Use `@default` for the default list.
- List tasks to get task IDs before completing, updating, or deleting.
- Due dates are RFC 3339 format (e.g., `2026-03-07T00:00:00Z`).
- To mark incomplete: patch with `{"status": "needsAction"}`.

---
name: create-skill
description: 创建可复用的自定义技能，保存工作流为技能 | Create reusable custom skills and save workflows
---

## Step 1: Create skill directory
```json
{"command": "mkdir -p skills/<skill-name>", "timeout": 5000}
```

## Step 2: Write SKILL.md
Use `file_write` tool to create `skills/<skill-name>/SKILL.md` with this template:

```
---
name: <skill-name>
description: 中文描述 | English description
---

## Step 0: Install dependency (first time only)
{"command": "pip install <package>", "timeout": 60000}

## <Action name>
{"command": "<exact command>", "timeout": 30000}

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- <domain-specific rules>
```

## Step 3 (optional): Create helper scripts
Use `file_write` to create `skills/<skill-name>/scripts/<script>.py`.

## Rules
- Directory name: kebab-case (e.g., `my-skill`).
- Description: bilingual (中文 | English).
- Commands MUST use JSON template format: `{"command": "...", "timeout": N}`.
- Scripts use relative paths (e.g., `skills/<name>/scripts/...`).
- `{WORKDIR}` is ONLY for output file paths, NOT for script paths.
- Skills auto-load via file watcher — no restart needed.

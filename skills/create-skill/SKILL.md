---
name: create-skill
description: 创建可复用的自定义技能，保存工作流为技能 | Create reusable custom skills and save workflows
---

When the user wants to save a workflow as a reusable skill:

1. Create a directory under `skills/`:
   ```
   shell: mkdir -p skills/<skill-name>
   ```

2. Write the SKILL.md file using file_write:
   ```
   file_write: skills/<skill-name>/SKILL.md
   ```

   SKILL.md format:
   ```markdown
   ---
   name: <skill-name>
   description: 中文描述，包含使用场景关键词 | English description with usage context
   ---

   <Instructions for the LLM on how to perform this task>
   ```

3. Optionally create helper scripts:
   ```
   file_write: skills/<skill-name>/scripts/helper.py
   ```

4. The skill will be auto-loaded by the file watcher — no restart needed.

Rules:
- Directory name should be kebab-case
- Description should be bilingual (Chinese | English) and include usage context keywords
- Instructions should be clear and self-contained
- Scripts should read from args/stdin and write to stdout

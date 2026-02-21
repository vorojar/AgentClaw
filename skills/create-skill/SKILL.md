---
name: create-skill
description: Create reusable skills
triggers:
  - type: keyword
    patterns: ["创建技能", "create skill", "保存工作流", "save workflow", "新技能", "new skill"]
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
   description: <one-line description>
   triggers:
     - type: keyword
       patterns: ["keyword1", "keyword2", "关键词"]
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
- Triggers should include both Chinese and English keywords
- Instructions should be clear and self-contained
- Scripts should read from args/stdin and write to stdout

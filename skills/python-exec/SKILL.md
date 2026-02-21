---
name: python-exec
description: Execute Python code via shell
triggers:
  - type: keyword
    patterns: ["python", "脚本", "计算", "数据处理", "matplotlib", "pandas", "numpy"]
---

When the user asks you to run Python code or perform tasks best suited for Python:

1. For short code snippets, use shell directly:
   ```
   shell: python -c "print('hello')"
   ```

2. For longer scripts, write to a temp file first then execute:
   ```
   file_write: data/tmp/_script.py  (write your code)
   shell: python data/tmp/_script.py
   ```

3. Always use `print()` to produce output — shell captures stdout.
4. Set environment: PYTHONIOENCODING=utf-8 is already configured.
5. Default timeout: 60 seconds. For long tasks, warn the user.

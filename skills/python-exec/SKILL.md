---
name: python-exec
description: 执行Python代码，数据处理、科学计算、图表绘制、文件转换 | Execute Python scripts for data processing, computation, and visualization
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

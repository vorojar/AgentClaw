---
name: docx
description: 创建、编辑和分析Word文档，支持格式设置、表格、图片插入 | Create, edit and analyze Word documents (.docx)
---

All output files go to `data/tmp/`. Use `file_write` to create the Python script, then `shell` to execute it.

## Step 0: Install dependency (first time only)
```json
{"command": "pip install python-docx", "timeout": 60000}
```

## Create a new document

```python
# file_write: data/tmp/_script.py
from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

doc = Document()

# --- Title ---
title = doc.add_heading("文档标题", level=0)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER

# --- Paragraph with formatting ---
p = doc.add_paragraph()
run = p.add_run("加粗文本")
run.bold = True
run.font.size = Pt(14)
run.font.color.rgb = RGBColor(0x00, 0x00, 0xFF)

p.add_run("  普通文本，").font.size = Pt(12)
run2 = p.add_run("斜体文本")
run2.italic = True

# --- Heading levels ---
doc.add_heading("一级标题", level=1)
doc.add_heading("二级标题", level=2)

# --- Bullet list ---
doc.add_paragraph("第一项", style="List Bullet")
doc.add_paragraph("第二项", style="List Bullet")
doc.add_paragraph("第三项", style="List Bullet")

# --- Numbered list ---
doc.add_paragraph("步骤一", style="List Number")
doc.add_paragraph("步骤二", style="List Number")

# --- Table ---
table = doc.add_table(rows=3, cols=3, style="Table Grid")
table.alignment = WD_TABLE_ALIGNMENT.CENTER
# Header row
for i, text in enumerate(["姓名", "年龄", "城市"]):
    table.rows[0].cells[i].text = text
# Data rows
data = [["张三", "28", "北京"], ["李四", "32", "上海"]]
for r, row_data in enumerate(data, 1):
    for c, val in enumerate(row_data):
        table.rows[r].cells[c].text = val

# --- Insert image (if available) ---
# doc.add_picture("data/tmp/image.png", width=Inches(4))

# --- Page break ---
doc.add_page_break()
doc.add_heading("第二页内容", level=1)
doc.add_paragraph("这是第二页的内容。")

doc.save("data/tmp/output.docx")
print("OK: data/tmp/output.docx")
```

Then execute:
```json
{"command": "python data/tmp/_script.py", "timeout": 30000}
```

## Read / analyze an existing document

```python
# file_write: data/tmp/_script.py
from docx import Document

doc = Document("data/tmp/input.docx")  # <-- replace with actual path

# Print all paragraphs
for i, para in enumerate(doc.paragraphs):
    print(f"[{i}] ({para.style.name}) {para.text}")

# Print all tables
for t_idx, table in enumerate(doc.tables):
    print(f"\n--- Table {t_idx} ---")
    for row in table.rows:
        print(" | ".join(cell.text for cell in row.cells))
```

## Add content to an existing document

```python
# file_write: data/tmp/_script.py
from docx import Document

doc = Document("data/tmp/existing.docx")  # <-- replace with actual path
doc.add_heading("新增章节", level=1)
doc.add_paragraph("这段内容是后来添加的。")
doc.save("data/tmp/existing_updated.docx")
print("OK: data/tmp/existing_updated.docx")
```

## Set page margins and orientation

```python
from docx import Document
from docx.shared import Cm
from docx.enum.section import WD_ORIENT

doc = Document()
section = doc.sections[0]
section.orientation = WD_ORIENT.LANDSCAPE  # 横向
section.page_width, section.page_height = section.page_height, section.page_width
section.top_margin = Cm(2)
section.bottom_margin = Cm(2)
section.left_margin = Cm(2.5)
section.right_margin = Cm(2.5)
```

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- Output path: `data/tmp/xxx.docx`. Use descriptive filenames, not just "output.docx".
- For user-uploaded files, read from the path the user provides.
- After generating the file, use `send_file` to deliver it to the user.
- If the user provides Chinese content, keep it as-is. Do NOT translate.
- For complex layouts, build incrementally: create basic structure first, then add formatting.

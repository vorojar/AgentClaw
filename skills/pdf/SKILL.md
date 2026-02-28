---
name: pdf
description: PDF文档处理，提取文字和表格、合并拆分、创建PDF | PDF manipulation - extract text/tables, merge/split, create PDFs
---

All output files go to the working directory (工作目录). Use `file_write` to create the Python script, then `shell` to execute it.

## Step 0: Install dependency (first time only)
```json
{"command": "pip install PyMuPDF", "timeout": 60000}
```

The import name is `fitz` (not `PyMuPDF`).

## Extract text from a PDF

```python
# file_write: {WORKDIR}/_script.py
import fitz  # PyMuPDF

doc = fitz.open("{WORKDIR}/input.pdf")  # <-- replace with actual path
print(f"Total pages: {len(doc)}")

for page_num in range(len(doc)):
    page = doc[page_num]
    text = page.get_text()
    print(f"\n===== Page {page_num + 1} =====")
    print(text)

doc.close()
```

Then execute:
```json
{"command": "python {WORKDIR}/_script.py", "timeout": 60000}
```

## Extract text from specific pages only

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open("{WORKDIR}/input.pdf")

# Pages 1-3 (0-indexed: 0, 1, 2)
for page_num in [0, 1, 2]:
    if page_num < len(doc):
        page = doc[page_num]
        print(f"\n===== Page {page_num + 1} =====")
        print(page.get_text())

doc.close()
```

## Extract tables from a PDF

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open("{WORKDIR}/input.pdf")

for page_num in range(len(doc)):
    page = doc[page_num]
    tables = page.find_tables()
    if tables.tables:
        print(f"\n===== Page {page_num + 1}: {len(tables.tables)} table(s) =====")
        for t_idx, table in enumerate(tables.tables):
            print(f"\n--- Table {t_idx} ---")
            data = table.extract()
            for row in data:
                print(" | ".join(str(cell) if cell else "" for cell in row))

doc.close()
```

## Merge multiple PDFs

```python
# file_write: {WORKDIR}/_script.py
import fitz

output = fitz.open()

files = [
    "{WORKDIR}/file1.pdf",
    "{WORKDIR}/file2.pdf",
    "{WORKDIR}/file3.pdf",
]

for f in files:
    doc = fitz.open(f)
    output.insert_pdf(doc)
    doc.close()

output.save("{WORKDIR}/merged.pdf")
output.close()
print("OK: {WORKDIR}/merged.pdf")
```

## Split PDF — extract specific pages

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open("{WORKDIR}/input.pdf")
output = fitz.open()

# Extract pages 2-5 (0-indexed: 1, 2, 3, 4)
output.insert_pdf(doc, from_page=1, to_page=4)

output.save("{WORKDIR}/pages_2_to_5.pdf")
output.close()
doc.close()
print("OK: {WORKDIR}/pages_2_to_5.pdf")
```

## Split PDF — each page as separate file

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open("{WORKDIR}/input.pdf")

for i in range(len(doc)):
    single = fitz.open()
    single.insert_pdf(doc, from_page=i, to_page=i)
    path = f"{WORKDIR}/page_{i+1}.pdf"
    single.save(path)
    single.close()
    print(f"OK: {path}")

doc.close()
```

## PDF pages to images (PNG)

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open("{WORKDIR}/input.pdf")

for i in range(len(doc)):
    page = doc[i]
    # zoom=2 for higher resolution (default=1 gives 72dpi, zoom=2 gives 144dpi)
    mat = fitz.Matrix(2, 2)
    pix = page.get_pixmap(matrix=mat)
    path = f"{WORKDIR}/page_{i+1}.png"
    pix.save(path)
    print(f"OK: {path}")

doc.close()
```

## Create a PDF with title and content

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open()
page = doc.new_page(width=595, height=842)  # A4

# Centered title (use insert_textbox with align for centering)
title_rect = fitz.Rect(50, 40, 545, 80)
page.insert_textbox(title_rect, "标题文字", fontsize=24, fontname="china-ss", align=fitz.TEXT_ALIGN_CENTER)

# Body text below title
body_rect = fitz.Rect(50, 100, 545, 792)
text = "正文内容...\n\n第二段内容..."
page.insert_textbox(body_rect, text, fontsize=14, fontname="china-s")

doc.save("{WORKDIR}/created.pdf")
doc.close()
print("OK: {WORKDIR}/created.pdf")
```

## Add watermark to PDF

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open("{WORKDIR}/input.pdf")

for page in doc:
    # Diagonal watermark text
    rect = page.rect
    page.insert_text(
        fitz.Point(rect.width / 4, rect.height / 2),
        "CONFIDENTIAL",
        fontsize=60,
        color=(0.8, 0.8, 0.8),  # light gray
        rotate=45,
    )

doc.save("{WORKDIR}/watermarked.pdf")
doc.close()
print("OK: {WORKDIR}/watermarked.pdf")
```

## Get PDF metadata / info

```python
# file_write: {WORKDIR}/_script.py
import fitz

doc = fitz.open("{WORKDIR}/input.pdf")
print(f"Pages: {len(doc)}")
print(f"Metadata: {doc.metadata}")
print(f"Is encrypted: {doc.is_encrypted}")
for i, page in enumerate(doc):
    print(f"Page {i+1}: {page.rect.width:.0f} x {page.rect.height:.0f} pts, {len(page.get_text())} chars")
doc.close()
```

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- Import name is `fitz`, NOT `PyMuPDF`. (`import fitz`)
- Output path: `{WORKDIR}/xxx.pdf` or `{WORKDIR}/xxx.png`. Use descriptive filenames.
- For large PDFs (>50 pages), process in batches or only the pages the user asks for.
- Chinese font for `insert_text` / `insert_textbox`: use `fontname="china-s"` (SimSun) or `fontname="china-ss"` (for bold).
- `insert_text()` does NOT support `align` parameter. For centered text, use `insert_textbox()` with `align=fitz.TEXT_ALIGN_CENTER`.
- `insert_textbox()` does NOT support `line_spacing`. Use `\n` for spacing between paragraphs.
- ONLY use parameters shown in the templates above. Do NOT guess or invent parameters.
- After generating the file, use `send_file` to deliver it to the user.
- timeout 60000 (1min) for most operations. Use 120000 for large files.

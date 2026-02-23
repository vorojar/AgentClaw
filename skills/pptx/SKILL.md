---
name: pptx
description: 创建、编辑和分析PowerPoint演示文稿，支持幻灯片布局、图表、动画 | Create, edit and analyze PowerPoint presentations (.pptx)
---

All output files go to `data/tmp/`. Use `file_write` to create the Python script, then `shell` to execute it.

## Step 0: Install dependency (first time only)
```json
{"command": "pip install python-pptx", "timeout": 60000}
```

## Create a presentation

```python
# file_write: data/tmp/_script.py
from pptx import Presentation
from pptx.util import Inches, Pt, Cm, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.chart import XL_CHART_TYPE

prs = Presentation()
prs.slide_width = Inches(13.333)   # 16:9 widescreen
prs.slide_height = Inches(7.5)

# ========== Slide 1: Title Slide ==========
slide_layout = prs.slide_layouts[0]  # Title Slide layout
slide = prs.slides.add_slide(slide_layout)
slide.shapes.title.text = "演示文稿标题"
slide.placeholders[1].text = "副标题 — 2024年度汇报"

# ========== Slide 2: Title + Content ==========
slide_layout = prs.slide_layouts[1]  # Title and Content layout
slide = prs.slides.add_slide(slide_layout)
slide.shapes.title.text = "项目概览"

tf = slide.placeholders[1].text_frame
tf.text = "第一个要点"
p = tf.add_paragraph()
p.text = "第二个要点"
p.level = 0
p = tf.add_paragraph()
p.text = "子要点（缩进）"
p.level = 1
p = tf.add_paragraph()
p.text = "第三个要点"
p.level = 0

# ========== Slide 3: Blank slide with custom textbox ==========
slide = prs.slides.add_slide(prs.slide_layouts[6])  # Blank layout

# Add text box
from pptx.util import Inches
txBox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1.5))
tf = txBox.text_frame
tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "自定义文本框内容"
p.font.size = Pt(24)
p.font.bold = True
p.font.color.rgb = RGBColor(0x1A, 0x5C, 0xB0)
p.alignment = PP_ALIGN.CENTER

# Add a second text box for body
txBox2 = slide.shapes.add_textbox(Inches(1), Inches(3), Inches(11), Inches(3))
tf2 = txBox2.text_frame
tf2.word_wrap = True
tf2.paragraphs[0].text = "这里是详细说明内容。可以包含多行文字。"
tf2.paragraphs[0].font.size = Pt(16)

# ========== Slide 4: Table ==========
slide = prs.slides.add_slide(prs.slide_layouts[6])
title_box = slide.shapes.add_textbox(Inches(1), Inches(0.3), Inches(8), Inches(0.8))
title_box.text_frame.paragraphs[0].text = "数据表格"
title_box.text_frame.paragraphs[0].font.size = Pt(28)
title_box.text_frame.paragraphs[0].font.bold = True

rows, cols = 4, 3
table_shape = slide.shapes.add_table(rows, cols, Inches(2), Inches(1.5), Inches(9), Inches(3))
table = table_shape.table

# Header
for i, h in enumerate(["项目", "Q1", "Q2"]):
    cell = table.cell(0, i)
    cell.text = h
    for paragraph in cell.text_frame.paragraphs:
        paragraph.font.bold = True
        paragraph.font.size = Pt(14)

# Data
data = [["产品A", "120万", "150万"], ["产品B", "80万", "95万"], ["产品C", "200万", "230万"]]
for r, row_data in enumerate(data, 1):
    for c, val in enumerate(row_data):
        table.cell(r, c).text = val

# ========== Slide 5: Image (if available) ==========
# slide = prs.slides.add_slide(prs.slide_layouts[6])
# slide.shapes.add_picture("data/tmp/image.png", Inches(1), Inches(1), width=Inches(8))

prs.save("data/tmp/output.pptx")
print("OK: data/tmp/output.pptx")
```

Then execute:
```json
{"command": "python data/tmp/_script.py", "timeout": 30000}
```

## Read / analyze an existing presentation

```python
# file_write: data/tmp/_script.py
from pptx import Presentation

prs = Presentation("data/tmp/input.pptx")  # <-- replace with actual path

print(f"Total slides: {len(prs.slides)}")
print(f"Slide size: {prs.slide_width} x {prs.slide_height}")

for i, slide in enumerate(prs.slides):
    print(f"\n--- Slide {i+1} (layout: {slide.slide_layout.name}) ---")
    for shape in slide.shapes:
        print(f"  [{shape.shape_type}] name={shape.name}, pos=({shape.left},{shape.top}), size=({shape.width},{shape.height})")
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                print(f"    text: {para.text}")
        if shape.has_table:
            for row in shape.table.rows:
                print(f"    row: {' | '.join(cell.text for cell in row.cells)}")
```

## Add a chart to a slide

```python
# file_write: data/tmp/_script.py
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

chart_data = CategoryChartData()
chart_data.categories = ["Q1", "Q2", "Q3", "Q4"]
chart_data.add_series("产品A", (120, 150, 180, 200))
chart_data.add_series("产品B", (80, 95, 110, 130))

chart = slide.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    Inches(1), Inches(1), Inches(10), Inches(5.5),
    chart_data
).chart

chart.has_legend = True
chart.legend.include_in_layout = False

prs.save("data/tmp/chart_pptx.pptx")
print("OK: data/tmp/chart_pptx.pptx")
```

## Insert an image into a specific slide

```python
from pptx import Presentation
from pptx.util import Inches

prs = Presentation("data/tmp/existing.pptx")
slide = prs.slides[0]  # first slide, change index as needed
slide.shapes.add_picture("data/tmp/image.png", Inches(1), Inches(2), width=Inches(6))
prs.save("data/tmp/existing_with_image.pptx")
print("OK")
```

## Common slide layouts
| Index | Name | Use for |
|-------|------|---------|
| 0 | Title Slide | 封面页 |
| 1 | Title and Content | 标题 + 正文要点 |
| 2 | Section Header | 章节分隔页 |
| 5 | Title Only | 只有标题，内容自由排版 |
| 6 | Blank | 完全空白，手动添加所有元素 |

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- Default slide size: 16:9 widescreen (13.333 x 7.5 inches). Set explicitly.
- Output path: `data/tmp/xxx.pptx`. Use descriptive filenames.
- For user-uploaded files, read from the path the user provides.
- After generating the file, use `send_file` to deliver it to the user.
- Keep Chinese content as-is. Do NOT translate.
- For many slides, build a loop — do NOT copy-paste the same code for each slide.

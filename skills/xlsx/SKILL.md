---
name: xlsx
description: 创建、编辑和分析Excel表格，支持公式、图表、数据处理 | Create, edit and analyze Excel spreadsheets (.xlsx)
---

All output files go to `data/tmp/`. Use `file_write` to create the Python script, then `shell` to execute it.

## Step 0: Install dependency (first time only)
```json
{"command": "pip install openpyxl", "timeout": 60000}
```

## Create a new workbook with data

```python
# file_write: data/tmp/_script.py
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "数据"

# --- Header row with styling ---
headers = ["姓名", "部门", "工资", "入职日期"]
header_font = Font(bold=True, size=12, color="FFFFFF")
header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
header_align = Alignment(horizontal="center", vertical="center")

for col, header in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=header)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = header_align

# --- Data rows ---
data = [
    ["张三", "技术部", 15000, "2023-01-15"],
    ["李四", "市场部", 12000, "2023-03-20"],
    ["王五", "技术部", 18000, "2022-11-01"],
    ["赵六", "财务部", 14000, "2023-06-10"],
]
for r, row_data in enumerate(data, 2):
    for c, val in enumerate(row_data, 1):
        ws.cell(row=r, column=c, value=val)

# --- Formulas ---
ws.cell(row=6, column=2, value="平均工资")
ws.cell(row=6, column=3, value="=AVERAGE(C2:C5)")
ws.cell(row=7, column=2, value="最高工资")
ws.cell(row=7, column=3, value="=MAX(C2:C5)")
ws.cell(row=8, column=2, value="总计")
ws.cell(row=8, column=3, value="=SUM(C2:C5)")

# --- Auto-adjust column widths ---
for col_idx in range(1, len(headers) + 1):
    ws.column_dimensions[get_column_letter(col_idx)].width = 15

# --- Freeze top row ---
ws.freeze_panes = "A2"

wb.save("data/tmp/output.xlsx")
print("OK: data/tmp/output.xlsx")
```

Then execute:
```json
{"command": "python data/tmp/_script.py", "timeout": 30000}
```

## Read / analyze an existing spreadsheet

```python
# file_write: data/tmp/_script.py
from openpyxl import load_workbook

wb = load_workbook("data/tmp/input.xlsx", data_only=True)  # data_only=True to read computed values

for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    print(f"\n=== Sheet: {sheet_name} ({ws.max_row} rows x {ws.max_column} cols) ===")
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 20), values_only=False):
        print(" | ".join(str(cell.value) if cell.value is not None else "" for cell in row))
    if ws.max_row > 20:
        print(f"... ({ws.max_row - 20} more rows)")
```

## Add a chart

```python
# file_write: data/tmp/_script.py
from openpyxl import load_workbook
from openpyxl.chart import BarChart, Reference

wb = load_workbook("data/tmp/output.xlsx")
ws = wb.active

chart = BarChart()
chart.type = "col"
chart.title = "工资对比"
chart.y_axis.title = "金额 (元)"
chart.x_axis.title = "员工"

# Categories (names): column 1, rows 2-5
cats = Reference(ws, min_col=1, min_row=2, max_row=5)
# Data (salaries): column 3, rows 1-5 (row 1 = header for series name)
data = Reference(ws, min_col=3, min_row=1, max_row=5)

chart.add_data(data, titles_from_data=True)
chart.set_categories(cats)
chart.shape = 4
chart.width = 18
chart.height = 10

ws.add_chart(chart, "E2")

wb.save("data/tmp/output_chart.xlsx")
print("OK: data/tmp/output_chart.xlsx")
```

## Create a second sheet

```python
from openpyxl import load_workbook

wb = load_workbook("data/tmp/output.xlsx")
ws2 = wb.create_sheet("汇总")
ws2["A1"] = "部门"
ws2["B1"] = "人数"
ws2.append(["技术部", 2])
ws2.append(["市场部", 1])
ws2.append(["财务部", 1])
wb.save("data/tmp/output.xlsx")
print("OK")
```

## Conditional formatting

```python
from openpyxl import load_workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import PatternFill

wb = load_workbook("data/tmp/output.xlsx")
ws = wb.active

# Highlight salaries > 15000 in green
green_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
ws.conditional_formatting.add("C2:C100",
    CellIsRule(operator="greaterThan", formula=["15000"], fill=green_fill))

wb.save("data/tmp/output.xlsx")
print("OK")
```

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- Output path: `data/tmp/xxx.xlsx`. Use descriptive filenames.
- Use `data_only=True` when reading to get computed formula values (not the formula string).
- For large datasets (>1000 rows), use `write_only=True` mode for better performance.
- After generating the file, use `send_file` to deliver it to the user.
- Keep Chinese content as-is. Do NOT translate.

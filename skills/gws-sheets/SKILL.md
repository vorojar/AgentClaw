---
name: gws-sheets
description: Google Sheets电子表格——读取、写入、追加数据 | Google Sheets via gws CLI (read, write, append spreadsheet data)
---

Requires: `gws` CLI installed and authenticated (`gws auth login`).

## Command syntax

```
gws sheets <resource> <method> --params '{"key":"val"}' --json '{"key":"val"}'
```

## Read cell range

```json
{"command": "gws sheets spreadsheets.values get --params '{\"spreadsheetId\":\"SPREADSHEET_ID\",\"range\":\"Sheet1!A1:D10\"}'", "timeout": 30000}
```

## Read entire sheet

```json
{"command": "gws sheets spreadsheets.values get --params '{\"spreadsheetId\":\"SPREADSHEET_ID\",\"range\":\"Sheet1\"}'", "timeout": 30000}
```

## Write cells (overwrite)

```json
{"command": "gws sheets spreadsheets.values update --params '{\"spreadsheetId\":\"SPREADSHEET_ID\",\"range\":\"Sheet1!A1\",\"valueInputOption\":\"USER_ENTERED\"}' --json '{\"values\":[[\"Name\",\"Score\"],[\"Alice\",95],[\"Bob\",87]]}'", "timeout": 30000}
```

## Append rows

```json
{"command": "gws sheets spreadsheets.values append --params '{\"spreadsheetId\":\"SPREADSHEET_ID\",\"range\":\"Sheet1!A:A\",\"valueInputOption\":\"USER_ENTERED\"}' --json '{\"values\":[[\"Charlie\",92]]}'", "timeout": 30000}
```

## Get spreadsheet metadata

```json
{"command": "gws sheets spreadsheets get --params '{\"spreadsheetId\":\"SPREADSHEET_ID\",\"fields\":\"sheets.properties\"}'", "timeout": 30000}
```

## Clear range

```json
{"command": "gws sheets spreadsheets.values clear --params '{\"spreadsheetId\":\"SPREADSHEET_ID\",\"range\":\"Sheet1!A1:D10\"}'", "timeout": 30000}
```

## Batch read multiple ranges

```json
{"command": "gws sheets spreadsheets.values batchGet --params '{\"spreadsheetId\":\"SPREADSHEET_ID\",\"ranges\":\"Sheet1!A1:B5\",\"ranges\":\"Sheet2!A1:C3\"}'", "timeout": 30000}
```

## Rules
- spreadsheetId is in the URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`.
- `valueInputOption`: `USER_ENTERED` (parses formulas/dates) or `RAW` (literal text).
- Range notation: `Sheet1!A1:D10`, `Sheet1!A:A` (whole column), `Sheet1` (whole sheet).
- Always use `fields` parameter on `spreadsheets.get` to limit metadata size.
- Use `gws schema sheets.spreadsheets.values.update` to discover all parameters.

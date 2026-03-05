---
name: gws-drive
description: Google Drive文件管理——搜索、上传、下载、共享文件 | Google Drive via gws CLI (search, upload, download, share files)
---

Requires: `gws` CLI installed and authenticated (`gws auth login`).

## Command syntax

```
gws drive <resource> <method> --params '{"key":"val"}' --json '{"key":"val"}'
```

- `--upload <PATH>` for file upload
- `--output <PATH>` for file download

## Search files

```json
{"command": "gws drive files list --params '{\"q\":\"name contains '\\''report'\\'' and mimeType != '\\''application/vnd.google-apps.folder'\\'''\",\"fields\":\"files(id,name,mimeType,modifiedTime,size)\",\"pageSize\":20}'", "timeout": 30000}
```

Common query operators: `name contains 'x'`, `mimeType = 'application/pdf'`, `trashed = false`, `'FOLDER_ID' in parents`, `modifiedTime > '2026-03-01T00:00:00'`.

## List files in a folder

```json
{"command": "gws drive files list --params '{\"q\":\"'\\''FOLDER_ID'\\'' in parents and trashed = false\",\"fields\":\"files(id,name,mimeType,modifiedTime,size)\"}'", "timeout": 30000}
```

## Download file

```json
{"command": "gws drive files get --params '{\"fileId\":\"FILE_ID\",\"alt\":\"media\"}' --output 'data/tmp/filename.pdf'", "timeout": 60000}
```

## Upload file

```json
{"command": "gws drive files create --json '{\"name\":\"report.pdf\",\"parents\":[\"FOLDER_ID\"]}' --upload 'data/tmp/report.pdf'", "timeout": 60000}
```

## Create folder

```json
{"command": "gws drive files create --json '{\"name\":\"New Folder\",\"mimeType\":\"application/vnd.google-apps.folder\",\"parents\":[\"PARENT_FOLDER_ID\"]}'", "timeout": 30000}
```

## Share file (add permission)

```json
{"command": "gws drive permissions create --params '{\"fileId\":\"FILE_ID\"}' --json '{\"role\":\"reader\",\"type\":\"user\",\"emailAddress\":\"alice@example.com\"}'", "timeout": 30000}
```

Roles: `reader`, `writer`, `commenter`, `owner`.

## Delete file (trash)

```json
{"command": "gws drive files update --params '{\"fileId\":\"FILE_ID\"}' --json '{\"trashed\":true}'", "timeout": 30000}
```

## Get file metadata

```json
{"command": "gws drive files get --params '{\"fileId\":\"FILE_ID\",\"fields\":\"id,name,mimeType,size,modifiedTime,webViewLink\"}'", "timeout": 30000}
```

## Rules
- Always use `fields` parameter to limit response size (saves tokens).
- Download to `data/tmp/` directory, then use send_file to deliver to user.
- For Google Docs/Sheets/Slides export: use `files.export` with `mimeType` param (e.g., `application/pdf`).
- Use `trashed = false` in queries to exclude trashed files.
- Folder mimeType: `application/vnd.google-apps.folder`.

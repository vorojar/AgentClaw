---
name: yt-dlp
description: 下载视频/音频（YouTube、Bilibili、Twitter等），支持格式选择和字幕提取 | Download video/audio from YouTube, Bilibili, Twitter etc.
---

All output files go to `data/tmp/`. Always use `auto_send: true` on the shell call.
Filenames use video ID (ASCII-safe) to avoid encoding issues on Windows.

## Download video (default: best quality mp4)
```json
{"command": "yt-dlp -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' --merge-output-format mp4 -o 'data/tmp/%(id)s.%(ext)s' 'URL'", "timeout": 300000, "auto_send": true}
```

## Download audio only (mp3)
```json
{"command": "yt-dlp -x --audio-format mp3 --audio-quality 0 -o 'data/tmp/%(id)s.%(ext)s' 'URL'", "timeout": 300000, "auto_send": true}
```

## Download with subtitles
```json
{"command": "yt-dlp -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' --merge-output-format mp4 --write-subs --sub-langs 'zh.*,en' --embed-subs -o 'data/tmp/%(id)s.%(ext)s' 'URL'", "timeout": 300000, "auto_send": true}
```

## List available formats (when user asks for specific quality)
```json
{"command": "yt-dlp -F 'URL'", "timeout": 30000}
```
Then let user choose, download with `-f FORMAT_ID`.

## Download specific resolution (e.g. 720p)
```json
{"command": "yt-dlp -f 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b' --merge-output-format mp4 -o 'data/tmp/%(id)s.%(ext)s' 'URL'", "timeout": 300000, "auto_send": true}
```

## Bilibili (needs cookies for high quality)
If download fails with 403 or low quality, try with cookies:
```json
{"command": "yt-dlp --cookies-from-browser chrome -f 'bv*+ba/b' --merge-output-format mp4 -o 'data/tmp/%(id)s.%(ext)s' 'URL'", "timeout": 300000, "auto_send": true}
```

## Playlist (download all)
```json
{"command": "yt-dlp -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' --merge-output-format mp4 -o 'data/tmp/%(playlist_id)s/%(playlist_index)03d-%(id)s.%(ext)s' --yes-playlist 'URL'", "timeout": 600000}
```
Playlists can be large — do NOT auto_send. Tell user the folder path instead.

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- ALWAYS quote the URL with single quotes (URLs contain special chars like & that bash interprets).
- timeout 300000 (5min) for single video, 600000 (10min) for playlists.
- If download fails, try `--cookies-from-browser chrome` (many sites need login for HD).
- For Twitter/X: URLs like `https://x.com/user/status/123` work directly.
- One command per video. Do NOT batch multiple URLs in one command.

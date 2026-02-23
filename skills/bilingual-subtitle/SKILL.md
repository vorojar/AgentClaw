---
name: bilingual-subtitle
description: 视频字幕提取、翻译、双语合并、烧录（GPU加速Whisper + Google翻译）| Extract subtitles from video, translate, merge bilingual, burn into video
---

Extract subtitles from video using Whisper (GPU-accelerated), translate to Chinese, and optionally burn bilingual subtitles into video.

All output files go to `data/tmp/`. Always use `auto_send: true` on the final shell call.

## Quick reference

### Extract subtitles only (fastest — no video encoding)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --srt-only -o data/tmp/OUTNAME_bilingual.srt", "timeout": 300000, "auto_send": true}
```

### Extract + burn into video (full pipeline)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' -o data/tmp/OUTNAME_bilingual.mp4", "timeout": 600000, "auto_send": true}
```

### Chinese-only subtitles (for videos with hardcoded English subs)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --chinese-only --srt-only -o data/tmp/OUTNAME_zh.srt", "timeout": 300000, "auto_send": true}
```

### Source-only subtitles (no translation)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --source-only --srt-only -o data/tmp/OUTNAME_source.srt", "timeout": 300000, "auto_send": true}
```

### Karaoke mode (word-level highlight)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --karaoke --fontsize 24 -o data/tmp/OUTNAME_karaoke.mp4", "timeout": 600000, "auto_send": true}
```

## Download from URL

### Subtitles / summary only → download audio (small & fast, Whisper only needs audio)
```
{"command": "yt-dlp -x --audio-format mp3 --audio-quality 0 -o 'data/tmp/%(id)s.%(ext)s' 'URL'", "timeout": 300000}
```
Then run process.py on the mp3 file with `--srt-only`.

### Burn subtitles into video → download video (need video source for encoding)
```
{"command": "yt-dlp -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' --merge-output-format mp4 -o 'data/tmp/%(id)s.%(ext)s' 'URL'", "timeout": 300000}
```
Then run process.py on the mp4 file without `--srt-only`.

## Parameters
| Parameter | Description | Default |
|---|---|---|
| `-o, --output` | Output file path | `<input>_<mode>.mp4` |
| `-l, --language` | Source language | `en` |
| `-t, --target` | Target language | `zh-CN` |
| `-m, --model` | Whisper model (tiny/base/small/medium/large) | `small` |
| `--fontsize` | Subtitle font size | `14` |
| `--margin` | Bottom margin | `25` |
| `--srt-only` | Generate subtitle file only, skip video encoding | - |
| `--chinese-only` | Output Chinese subtitles only | - |
| `--source-only` | Output source language subtitles only (no translation) | - |
| `--karaoke` | Karaoke mode with word-level highlight | - |
| `--no-speech-threshold` | Filter non-speech segments (0-1) | `0.6` |

## Rules
- ALWAYS use bash shell (default), never PowerShell.
- timeout: 300000 (5min) for --srt-only, 600000 (10min) for full pipeline with video encoding.
- GPU auto-detected: NVIDIA CUDA > Apple Silicon mlx > CPU int8. No config needed.
- For Chinese source videos, use `-l zh` to set source language.
- The script outputs progress to stdout. Do NOT set timeout too low.

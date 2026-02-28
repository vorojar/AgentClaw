---
name: bilingual-subtitle
description: 视频字幕提取、翻译、双语合并、烧录（GPU加速Whisper + Google翻译）| Extract subtitles from video, translate, merge bilingual, burn into video
---

Extract subtitles from video using Whisper (GPU-accelerated), translate to Chinese, and optionally burn bilingual subtitles into video.

All output files go to the working directory (工作目录). Always use `auto_send: true` on the final shell call.

## Quick reference

### Extract subtitles only (fastest — no video encoding)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --srt-only -o {WORKDIR}/OUTNAME_bilingual.srt", "timeout": 300000, "auto_send": true}
```

### Extract + burn into video (full pipeline)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' -o {WORKDIR}/OUTNAME_bilingual.mp4", "timeout": 600000, "auto_send": true}
```

### Chinese-only subtitles (for videos with hardcoded English subs)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --chinese-only --srt-only -o {WORKDIR}/OUTNAME_zh.srt", "timeout": 300000, "auto_send": true}
```

### Source-only subtitles (no translation)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --source-only --srt-only -o {WORKDIR}/OUTNAME_source.srt", "timeout": 300000, "auto_send": true}
```

### Karaoke mode (word-level highlight)
```
{"command": "python skills/bilingual-subtitle/scripts/process.py 'VIDEO_FILE' --karaoke --fontsize 24 -o {WORKDIR}/OUTNAME_karaoke.mp4", "timeout": 600000, "auto_send": true}
```

## Download from URL

### Step 1: Try CC subtitles first (fastest — skip Whisper if available)
```
{"command": "yt-dlp --no-warnings --write-auto-subs --write-subs --sub-langs 'en,zh*' --skip-download --convert-subs srt -o '{WORKDIR}/%(id)s' 'URL'", "timeout": 60000}
```
If SRT files are downloaded (e.g. `{WORKDIR}/ID.en.srt`), use them directly — no need to run Whisper.
If output says "There are no subtitles", fall back to Step 2.

### Step 2a: Subtitles / summary only → download audio (Whisper only needs audio)
```
{"command": "yt-dlp --no-warnings -x --audio-format mp3 --audio-quality 0 -o '{WORKDIR}/%(id)s.%(ext)s' 'URL'", "timeout": 300000}
```
Then run process.py on the mp3 file with `--srt-only`.

### Step 2b: Burn subtitles into video → download video (need video source for encoding)
```
{"command": "yt-dlp --no-warnings -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' --merge-output-format mp4 -o '{WORKDIR}/%(id)s.%(ext)s' 'URL'", "timeout": 300000}
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

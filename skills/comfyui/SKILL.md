---
name: comfyui
description: AI图片生成和处理（文生图、图生图、去背景、放大）| AI image generation and processing (text-to-image, remove background, upscale)
---

All output files go to the working directory (工作目录). Always use `auto_send: true` on the shell call.
ComfyUI must be running at http://127.0.0.1:8000.

## Text-to-Image
```json
{"command": "python skills/comfyui/scripts/comfyui.py --output-dir '{WORKDIR}' generate --prompt \"description\" --width 1024 --height 1024", "timeout": 120000, "auto_send": true}
```
Optional args: `--steps 9` (default 9), `--seed 12345`

## Remove Background
```json
{"command": "python skills/comfyui/scripts/comfyui.py --output-dir '{WORKDIR}' remove_bg --image path/to/image.png", "timeout": 120000, "auto_send": true}
```

## Upscale (4x)
```json
{"command": "python skills/comfyui/scripts/comfyui.py --output-dir '{WORKDIR}' upscale --image path/to/image.png", "timeout": 120000, "auto_send": true}
```

## Rules
- ALWAYS copy the JSON template above EXACTLY. Do not improvise commands.
- ALWAYS set `"timeout": 120000` — image generation takes 30-120 seconds.
- Do NOT check if ComfyUI is running first. Just run the command.
- Do NOT write your own Python code. Use the script above exactly.

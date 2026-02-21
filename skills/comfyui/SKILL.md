---
name: comfyui
description: AI图片生成和处理（文生图、图生图、去背景、放大）| AI image generation and processing (text-to-image, remove background, upscale)
---

Use the ComfyUI script for AI image generation and processing.
ComfyUI must be running at http://127.0.0.1:8000.

## Text-to-Image
```json
{"command": "python skills/comfyui/scripts/comfyui.py generate --prompt \"description\" --width 1024 --height 1024", "timeout": 120000}
```
Optional args: `--steps 9` (default 9), `--seed 12345`

## Remove Background
```json
{"command": "python skills/comfyui/scripts/comfyui.py remove_bg --image path/to/image.png", "timeout": 120000}
```

## Upscale (4x)
```json
{"command": "python skills/comfyui/scripts/comfyui.py upscale --image path/to/image.png", "timeout": 120000}
```

## Rules
- ALWAYS set `"timeout": 120000` — image generation takes 30-120 seconds.
- After the script prints the output file path, use send_file to deliver it.
- Do NOT check if ComfyUI is running first. Just run the command.
- Do NOT write your own Python code. Use the script above exactly.

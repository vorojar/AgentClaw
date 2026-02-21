---
name: comfyui
description: AI image generation and processing via ComfyUI
triggers:
  - type: keyword
    patterns: ["画", "生成图", "图片", "generate image", "comfyui", "画图", "作图", "图像", "去背景", "抠图", "超分辨率", "upscale", "放大图片", "remove background"]
---

Use the ComfyUI script for AI image generation and processing.
ComfyUI must be running at http://127.0.0.1:8000.

## Text-to-Image
```
shell: python3 skills/comfyui/scripts/comfyui.py generate --prompt "a cute cat" --width 1024 --height 1024
```
Optional: `--steps 9` (default 9), `--seed 12345`

## Remove Background
```
shell: python3 skills/comfyui/scripts/comfyui.py remove_bg --image path/to/image.png
```

## Upscale (4x)
```
shell: python3 skills/comfyui/scripts/comfyui.py upscale --image path/to/image.png
```

After the script completes, it prints the output file path. Use send_file to send it to the user.
See WORKFLOWS.md for workflow details.

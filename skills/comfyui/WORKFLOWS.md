# ComfyUI Workflows

## Text-to-Image (Lumina2)
- Model: z_image_turbo_bf16.safetensors
- CLIP: qwen_3_4b.safetensors (lumina2 type)
- VAE: ae.safetensors
- Sampler: res_multistep, simple scheduler
- CFG: 1, Denoise: 1
- Default: 1024x1024, 9 steps
- Uses ModelSamplingAuraFlow with shift=3

## Remove Background (RMBG)
- Model: RMBG-2.0
- Sensitivity: 1, Process resolution: 1024
- Output: Alpha channel background

## Upscale
- Model: RealESRGAN_x4plus.pth
- Scale: 4x

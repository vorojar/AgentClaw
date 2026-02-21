#!/usr/bin/env python3
"""ComfyUI image generation and processing."""

import argparse
import json
import os
import random
import sys
import time
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000"
OUTPUT_DIR = os.path.join(os.getcwd(), "data", "tmp")
POLL_INTERVAL = 2
MAX_WAIT = 120


def submit_prompt(workflow: dict) -> str:
    payload = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
    return data["prompt_id"]


def upload_image(local_path: str) -> str:
    import mimetypes

    filename = os.path.basename(local_path)
    content_type = mimetypes.guess_type(local_path)[0] or "image/png"

    boundary = "----FormBoundary" + str(random.randint(100000, 999999))
    with open(local_path, "rb") as f:
        file_data = f.read()

    body = (
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        + file_data
        + (
            f"\r\n--{boundary}\r\n"
            f'Content-Disposition: form-data; name="overwrite"\r\n\r\n'
            f"true\r\n--{boundary}--\r\n"
        ).encode()
    )

    req = urllib.request.Request(
        f"{BASE_URL}/api/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
    return data["name"]


def poll_history(prompt_id: str):
    deadline = time.time() + MAX_WAIT
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        try:
            url = f"{BASE_URL}/api/history/{prompt_id}"
            with urllib.request.urlopen(url) as resp:
                history = json.loads(resp.read().decode())
            if prompt_id in history:
                return history[prompt_id]
        except Exception:
            pass
    return None


def extract_image_info(entry: dict):
    outputs = entry.get("outputs", {})
    for node_output in outputs.values():
        images = node_output.get("images", [])
        if images:
            return images[0]
    return None


def download_image(info: dict) -> str:
    from urllib.parse import urlencode

    params = {"filename": info["filename"], "type": info["type"]}
    if info.get("subfolder"):
        params["subfolder"] = info["subfolder"]
    url = f"{BASE_URL}/api/view?{urlencode(params)}"

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    local_path = os.path.join(OUTPUT_DIR, info["filename"])

    with urllib.request.urlopen(url) as resp:
        with open(local_path, "wb") as f:
            f.write(resp.read())
    return local_path


def build_generate_workflow(prompt, width, height, steps, seed):
    return {
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["43", 0], "filename_prefix": "z-image-web"},
        },
        "39": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen_3_4b.safetensors",
                "type": "lumina2",
                "device": "default",
            },
        },
        "40": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "41": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "42": {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["45", 0]},
        },
        "43": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["44", 0], "vae": ["40", 0]},
        },
        "44": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["47", 0],
                "positive": ["45", 0],
                "negative": ["42", 0],
                "latent_image": ["41", 0],
                "seed": seed,
                "steps": steps,
                "cfg": 1,
                "sampler_name": "res_multistep",
                "scheduler": "simple",
                "denoise": 1,
            },
        },
        "45": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["39", 0], "text": prompt},
        },
        "46": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "z_image_turbo_bf16.safetensors",
                "weight_dtype": "default",
            },
        },
        "47": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["46", 0], "shift": 3},
        },
    }


def build_rmbg_workflow(image_name):
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {
            "class_type": "RMBG",
            "inputs": {
                "image": ["1", 0],
                "model": "RMBG-2.0",
                "sensitivity": 1,
                "process_res": 1024,
                "mask_blur": 0,
                "mask_offset": 0,
                "invert_output": False,
                "refine_foreground": False,
                "background": "Alpha",
                "background_color": "#222222",
            },
        },
        "3": {
            "class_type": "SaveImage",
            "inputs": {"images": ["2", 0], "filename_prefix": "rmbg"},
        },
    }


def build_upscale_workflow(image_name):
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {
            "class_type": "UpscaleModelLoader",
            "inputs": {"model_name": "RealESRGAN_x4plus.pth"},
        },
        "3": {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]},
        },
        "4": {
            "class_type": "SaveImage",
            "inputs": {"images": ["3", 0], "filename_prefix": "upscale-4x"},
        },
    }


def run_workflow(workflow, label):
    prompt_id = submit_prompt(workflow)
    print(f"Submitted {label} (prompt_id: {prompt_id}), waiting...")

    entry = poll_history(prompt_id)
    if not entry:
        print(f"Error: Timed out after {MAX_WAIT}s", file=sys.stderr)
        sys.exit(1)

    img = extract_image_info(entry)
    if not img:
        print("Error: No output image found", file=sys.stderr)
        sys.exit(1)

    local_path = download_image(img)
    print(f"Output saved: {local_path.replace(chr(92), '/')}")
    return local_path


def main():
    parser = argparse.ArgumentParser(description="ComfyUI image processing")
    sub = parser.add_subparsers(dest="action", required=True)

    gen = sub.add_parser("generate", help="Text-to-image generation")
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--width", type=int, default=1024)
    gen.add_argument("--height", type=int, default=1024)
    gen.add_argument("--steps", type=int, default=9)
    gen.add_argument("--seed", type=int, default=None)

    rmbg = sub.add_parser("remove_bg", help="Remove background")
    rmbg.add_argument("--image", required=True)

    up = sub.add_parser("upscale", help="Upscale 4x")
    up.add_argument("--image", required=True)

    args = parser.parse_args()

    if args.action == "generate":
        seed = args.seed if args.seed is not None else random.randint(0, 2**52)
        wf = build_generate_workflow(
            args.prompt, args.width, args.height, args.steps, seed
        )
        run_workflow(wf, f"generate (seed={seed})")
        print(f"Seed: {seed}, Size: {args.width}x{args.height}, Steps: {args.steps}")
    elif args.action == "remove_bg":
        uploaded = upload_image(args.image)
        wf = build_rmbg_workflow(uploaded)
        run_workflow(wf, "remove_background")
    elif args.action == "upscale":
        uploaded = upload_image(args.image)
        wf = build_upscale_workflow(uploaded)
        run_workflow(wf, "upscale")


if __name__ == "__main__":
    main()

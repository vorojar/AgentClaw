import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

const COMFYUI_BASE = "http://127.0.0.1:8000";
const OUTPUT_DIR = resolve(process.cwd(), "data", "tmp");
const POLL_INTERVAL = 2_000;
const MAX_WAIT = 120_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Submit a workflow and return the prompt_id */
async function submitPrompt(
  workflow: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${COMFYUI_BASE}/api/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI returned HTTP ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { prompt_id: string };
  return data.prompt_id;
}

/** Upload a local image to ComfyUI, return the server-side filename */
async function uploadImage(localPath: string): Promise<string> {
  const fileBuffer = readFileSync(localPath);
  const fileName = basename(localPath);

  const form = new FormData();
  form.append("image", new Blob([fileBuffer]), fileName);
  form.append("overwrite", "true");

  const res = await fetch(`${COMFYUI_BASE}/api/upload/image`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed HTTP ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { name: string };
  return data.name;
}

type ImageInfo = { filename: string; subfolder: string; type: string };

/** Poll history until the prompt completes, return the history entry */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pollHistory(promptId: string): Promise<any> {
  const deadline = Date.now() + MAX_WAIT;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    try {
      const res = await fetch(`${COMFYUI_BASE}/api/history/${promptId}`);
      if (!res.ok) continue;
      const history = (await res.json()) as Record<string, unknown>;
      if (history[promptId]) return history[promptId];
    } catch {
      // ComfyUI might be busy, keep polling
    }
  }
  return null;
}

/** Extract the first output image info from a history entry */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImageInfo(historyEntry: any): ImageInfo | null {
  const outputs = historyEntry.outputs as Record<
    string,
    { images?: ImageInfo[] }
  >;
  for (const nodeOutput of Object.values(outputs)) {
    if (nodeOutput.images && nodeOutput.images.length > 0) {
      return nodeOutput.images[0]!;
    }
  }
  return null;
}

/** Download an output image from ComfyUI and save to local tmp dir */
async function downloadImage(info: ImageInfo): Promise<string> {
  const params = new URLSearchParams({
    filename: info.filename,
    type: info.type,
  });
  if (info.subfolder) params.set("subfolder", info.subfolder);

  const res = await fetch(`${COMFYUI_BASE}/api/view?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to download image: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();

  try {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  } catch {
    // may already exist
  }
  const localPath = resolve(OUTPUT_DIR, info.filename);
  writeFileSync(localPath, Buffer.from(buf));
  return localPath;
}

/** Run a full ComfyUI job: submit → poll → download → send */
async function runWorkflow(
  workflow: Record<string, unknown>,
  caption: string,
  context?: ToolExecutionContext,
): Promise<{ localPath: string; imageInfo: ImageInfo; promptId: string }> {
  const promptId = await submitPrompt(workflow);

  const historyEntry = await pollHistory(promptId);
  if (!historyEntry) {
    throw new Error(
      `ComfyUI timed out after ${MAX_WAIT / 1000}s (prompt_id: ${promptId})`,
    );
  }

  const imageInfo = extractImageInfo(historyEntry);
  if (!imageInfo) {
    throw new Error(
      `ComfyUI completed but no output image found (prompt_id: ${promptId})`,
    );
  }

  const localPath = await downloadImage(imageInfo);

  if (context?.sendFile) {
    try {
      await context.sendFile(localPath, caption);
    } catch {
      // sendFile failed but we still have the file locally
    }
  }

  return { localPath, imageInfo, promptId };
}

// ---------------------------------------------------------------------------
// Workflow builders
// ---------------------------------------------------------------------------

function buildGenerateWorkflow(
  prompt: string,
  width: number,
  height: number,
  steps: number,
  seed: number,
): Record<string, unknown> {
  return {
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["43", 0], filename_prefix: "z-image-web" },
    },
    "39": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_3_4b.safetensors",
        type: "lumina2",
        device: "default",
      },
    },
    "40": {
      class_type: "VAELoader",
      inputs: { vae_name: "ae.safetensors" },
    },
    "41": {
      class_type: "EmptySD3LatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "42": {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["45", 0] },
    },
    "43": {
      class_type: "VAEDecode",
      inputs: { samples: ["44", 0], vae: ["40", 0] },
    },
    "44": {
      class_type: "KSampler",
      inputs: {
        model: ["47", 0],
        positive: ["45", 0],
        negative: ["42", 0],
        latent_image: ["41", 0],
        seed,
        steps,
        cfg: 1,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1,
      },
    },
    "45": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["39", 0], text: prompt },
    },
    "46": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "z_image_turbo_bf16.safetensors",
        weight_dtype: "default",
      },
    },
    "47": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: ["46", 0], shift: 3 },
    },
  };
}

function buildRemoveBackgroundWorkflow(
  imageName: string,
): Record<string, unknown> {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: imageName },
    },
    "2": {
      class_type: "RMBG",
      inputs: {
        image: ["1", 0],
        model: "RMBG-2.0",
        sensitivity: 1,
        process_res: 1024,
        mask_blur: 0,
        mask_offset: 0,
        invert_output: false,
        refine_foreground: false,
        background: "Alpha",
        background_color: "#222222",
      },
    },
    "3": {
      class_type: "SaveImage",
      inputs: { images: ["2", 0], filename_prefix: "rmbg" },
    },
  };
}

function buildUpscaleWorkflow(imageName: string): Record<string, unknown> {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: imageName },
    },
    "2": {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: "RealESRGAN_x4plus.pth" },
    },
    "3": {
      class_type: "ImageUpscaleWithModel",
      inputs: { upscale_model: ["2", 0], image: ["1", 0] },
    },
    "4": {
      class_type: "SaveImage",
      inputs: { images: ["3", 0], filename_prefix: "upscale-4x" },
    },
  };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleGenerate(
  input: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const prompt = input.prompt as string;
  if (!prompt) {
    return { content: "Missing required parameter: prompt", isError: true };
  }
  const width = (input.width as number) ?? 1024;
  const height = (input.height as number) ?? 1024;
  const steps = (input.steps as number) ?? 9;
  const seed = (input.seed as number) ?? Math.floor(Math.random() * 2 ** 52);

  const workflow = buildGenerateWorkflow(prompt, width, height, steps, seed);
  const { localPath } = await runWorkflow(workflow, prompt, context);

  return {
    content: `Image generated and already sent to the user (do NOT call send_file again).\nFile: ${localPath}\nSeed: ${seed}\nSize: ${width}x${height}\nSteps: ${steps}`,
    isError: false,
    metadata: { localPath, seed, width, height, steps },
  };
}

async function handleRemoveBackground(
  input: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const imagePath = input.image_path as string;
  if (!imagePath) {
    return { content: "Missing required parameter: image_path", isError: true };
  }

  const uploadedName = await uploadImage(imagePath);
  const workflow = buildRemoveBackgroundWorkflow(uploadedName);
  const { localPath } = await runWorkflow(
    workflow,
    "Background removed",
    context,
  );

  return {
    content: `Background removed and image already sent to the user (do NOT call send_file again).\nFile: ${localPath}`,
    isError: false,
    metadata: { localPath, originalImage: imagePath },
  };
}

async function handleUpscale(
  input: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const imagePath = input.image_path as string;
  if (!imagePath) {
    return { content: "Missing required parameter: image_path", isError: true };
  }

  const uploadedName = await uploadImage(imagePath);
  const workflow = buildUpscaleWorkflow(uploadedName);
  const { localPath } = await runWorkflow(workflow, "Upscaled 4x", context);

  return {
    content: `Image upscaled 4x and already sent to the user (do NOT call send_file again).\nFile: ${localPath}`,
    isError: false,
    metadata: { localPath, originalImage: imagePath },
  };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const comfyuiGenerateTool: Tool = {
  name: "comfyui",
  description:
    "Process images using ComfyUI on the local machine. Supports three actions: " +
    "'generate' (text-to-image), 'remove_background' (remove image background), " +
    "and 'upscale' (4x super-resolution). " +
    "IMPORTANT: This tool automatically sends the result image to the user. " +
    "NEVER call send_file after using this tool, or the user will receive duplicate images.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "The action to perform: generate, remove_background, upscale",
      },
      prompt: {
        type: "string",
        description:
          "Text description of the image to generate (for 'generate' action)",
      },
      image_path: {
        type: "string",
        description:
          "Local file path of the image to process (for 'remove_background' and 'upscale' actions)",
      },
      width: {
        type: "number",
        description: "Image width in pixels (for 'generate', default: 1024)",
        default: 1024,
      },
      height: {
        type: "number",
        description: "Image height in pixels (for 'generate', default: 1024)",
        default: 1024,
      },
      steps: {
        type: "number",
        description: "Number of sampling steps (for 'generate', default: 9)",
        default: 9,
      },
      seed: {
        type: "number",
        description:
          "Random seed for reproducibility (for 'generate', default: random)",
      },
    },
    required: ["action"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const action = input.action as string;

    try {
      switch (action) {
        case "generate":
          return await handleGenerate(input, context);
        case "remove_background":
          return await handleRemoveBackground(input, context);
        case "upscale":
          return await handleUpscale(input, context);
        default:
          return {
            content: `Unknown action: "${action}". Supported: generate, remove_background, upscale`,
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `ComfyUI action "${action}" failed — is ComfyUI running? (${message})`,
        isError: true,
      };
    }
  },
};

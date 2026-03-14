import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

/**
 * Download an image URL and return base64 + mimeType.
 * Note: webp is normalized to image/png since some platforms (e.g. 即刻) don't accept webp via paste.
 * The actual pixel data stays the same — we just label it as png so the File object gets a .png extension.
 */
async function downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  let buf: Buffer;
  let mimeType: string;

  if (url.startsWith("/") || url.startsWith("data/") || /^[A-Z]:/i.test(url)) {
    // Local file
    const { readFileSync } = await import("node:fs");
    const { extname } = await import("node:path");
    const ext = extname(url).toLowerCase().replace(".", "");
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    buf = readFileSync(url);
    mimeType = mimeMap[ext] || "image/png";
  } else {
    // Remote URL
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download image: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    mimeType = ct.split(";")[0].trim();
  }

  // Normalize webp → png (many platforms reject webp via clipboard paste)
  if (mimeType === "image/webp") {
    mimeType = "image/png";
  }

  return { base64: buf.toString("base64"), mimeType };
}

/**
 * Platform configurations: URL, selectors, char limits.
 * All browser automation is handled internally — LLM just calls post(platform, text).
 */
interface PlatformConfig {
  name: string;
  postUrl: string;
  textSelector: string;
  submitSelector: string;
  charLimit?: number;
  /** Extra wait after page load (ms) */
  loadWait?: number;
  /** Extra wait after submit (ms) */
  submitWait?: number;
  /** Steps to run before typing (e.g. click to focus a compose area) */
  preSteps?: Array<{ action: string; args: Record<string, unknown> }>;
}

const PLATFORMS: Record<string, PlatformConfig> = {
  x: {
    name: "X (Twitter)",
    postUrl: "https://x.com/compose/post",
    textSelector: "[data-testid=tweetTextarea_0]",
    submitSelector: "[data-testid=tweetButton]",
    charLimit: 280,
    loadWait: 2000,
    submitWait: 3000,
  },
  xiaohongshu: {
    name: "小红书",
    postUrl: "https://creator.xiaohongshu.com/publish/publish?source=web&from=tab_switch",
    textSelector: "div.ql-editor[contenteditable=true]",
    submitSelector: "button.publishBtn, button[class*=publish]",
    loadWait: 3000,
    submitWait: 3000,
    preSteps: [
      // 创作者平台默认在视频tab，需要先切到图文tab
      {
        action: "click",
        args: { selector: "text=上传图文" },
      },
      // 等待图文上传区域加载
      {
        action: "sleep",
        args: { ms: 1000 },
      },
    ],
  },
  jike: {
    name: "即刻",
    postUrl: "https://web.okjike.com/",
    textSelector: "div[contenteditable=true]",
    submitSelector: "button[class*=submit], button[class*=Send], button[class*=send]",
    loadWait: 3000,
    submitWait: 3000,
    preSteps: [
      // 即刻首页需要先点击发布区域展开编辑器
      {
        action: "click",
        args: { selector: "div[contenteditable=true]" },
      },
    ],
  },
};

/**
 * Execute browser batch via gateway HTTP API (same as browser.mjs does).
 */
async function execBrowserBatch(
  steps: Array<{ action: string; args?: Record<string, unknown> }>,
  _context?: ToolExecutionContext,
): Promise<{ results: Array<{ step: number; action: string; ok: boolean; error?: string; [k: string]: unknown }> }> {
  const port = process.env.PORT || 3100;
  const apiKey = process.env.API_KEY || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`http://localhost:${port}/api/browser/exec`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "batch", args: { steps, auto_close: true } }),
  });

  const data = (await res.json()) as { result?: { results: Array<Record<string, unknown>> }; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.result as { results: Array<{ step: number; action: string; ok: boolean; error?: string }> };
}

export const socialPostTool: Tool = {
  name: "social_post",
  category: "builtin",
  description:
    "Post text (with optional images) to social media (X/Twitter, 小红书, 即刻). " +
    "One call = done. Handles browser automation internally.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        description: "Target platform",
        enum: Object.keys(PLATFORMS),
      },
      text: {
        type: "string",
        description: "Text content to post",
      },
      images: {
        type: "array",
        description: "Image URLs or local file paths to attach (max 4)",
        items: { type: "string" },
      },
    },
    required: ["platform", "text"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const platformKey = input.platform as string;
    const text = input.text as string;
    const imageUrls = (input.images as string[] | undefined) || [];

    const config = PLATFORMS[platformKey];
    if (!config) {
      return {
        content: `Unknown platform: ${platformKey}. Supported: ${Object.keys(PLATFORMS).join(", ")}`,
        isError: true,
      };
    }

    if (!text?.trim()) {
      return { content: "Text is empty", isError: true };
    }

    // Enforce char limit
    if (config.charLimit && text.length > config.charLimit) {
      return {
        content: `Text too long: ${text.length} chars (limit: ${config.charLimit} for ${config.name}). Shorten the text first.`,
        isError: true,
      };
    }

    // Download images upfront (before building steps)
    const imageData: Array<{ base64: string; mimeType: string }> = [];
    for (const imgUrl of imageUrls.slice(0, 4)) {
      try {
        imageData.push(await downloadImageAsBase64(imgUrl));
      } catch (err) {
        return {
          content: `Failed to download image ${imgUrl}: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    }

    // Build batch steps
    const steps: Array<{ action: string; args?: Record<string, unknown> }> = [];

    // 1. Open post page
    steps.push({ action: "open", args: { url: config.postUrl } });

    // 2. Wait for page to load
    if (config.loadWait) {
      steps.push({ action: "sleep", args: { ms: config.loadWait } });
    }

    // 3. Pre-steps (e.g. click to focus)
    if (config.preSteps) {
      steps.push(...config.preSteps);
    }

    // 4. Type text
    steps.push({ action: "type", args: { selector: config.textSelector, text } });

    // 5. Paste images (if any) — after text, before submit
    for (const img of imageData) {
      steps.push({ action: "paste_image", args: { base64: img.base64, mimeType: img.mimeType } });
      // Wait for image upload/processing
      steps.push({ action: "sleep", args: { ms: 2000 } });
    }

    // 6. Click submit
    steps.push({
      action: "click",
      args: { selector: config.submitSelector, timeout: 10000 },
    });

    // 7. Wait for submission
    if (config.submitWait) {
      steps.push({ action: "sleep", args: { ms: config.submitWait } });
    }

    // 8. Screenshot for confirmation
    steps.push({ action: "screenshot" });

    try {
      const result = await execBrowserBatch(steps, context);
      const allOk = result.results.every((r) => r.ok);
      const lastFailed = result.results.find((r) => !r.ok);

      if (!allOk && lastFailed) {
        return {
          content: `Failed at step ${lastFailed.step} (${lastFailed.action}): ${lastFailed.error}\nPlatform: ${config.name}`,
          isError: true,
        };
      }

      // Find screenshot result
      const screenshotStep = result.results.find(
        (r) => r.action === "screenshot" && r.ok && r.base64,
      );
      let screenshotInfo = "";
      if (screenshotStep?.base64) {
        // Save screenshot
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(process.cwd(), "data", "tmp").replace(/\\/g, "/");
        mkdirSync(dir, { recursive: true });
        const filename = `social_${platformKey}_${Date.now()}.png`;
        const filePath = join(dir, filename).replace(/\\/g, "/");
        writeFileSync(filePath, Buffer.from(screenshotStep.base64 as string, "base64"));
        screenshotInfo = `\nScreenshot: ${filePath}`;

        // Auto-send screenshot if possible
        if (context?.sendFile) {
          await context.sendFile(filePath, `Posted to ${config.name}`);
        }
      }

      return {
        content: `Posted to ${config.name} successfully.${screenshotInfo}`,
        isError: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Check if it's a connection error (extension not connected)
      if (msg.includes("503") || msg.includes("未连接")) {
        return {
          content: `Browser extension not connected. Cannot post to ${config.name}.`,
          isError: true,
        };
      }
      return {
        content: `Failed to post to ${config.name}: ${msg}`,
        isError: true,
      };
    }
  },
};

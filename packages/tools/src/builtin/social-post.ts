import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

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
    postUrl: "https://www.xiaohongshu.com/publish/publish?source=web",
    textSelector: "div.ql-editor[contenteditable=true]",
    submitSelector: "button.publishBtn, button[class*=publish]",
    loadWait: 3000,
    submitWait: 3000,
    preSteps: [
      // 小红书发布页需要先点击"发布笔记"区域
      {
        action: "click",
        args: { selector: "div.ql-editor[contenteditable=true]" },
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
  context?: ToolExecutionContext,
): Promise<{ results: Array<{ step: number; action: string; ok: boolean; error?: string; [k: string]: unknown }> }> {
  const port = process.env.PORT || 3100;
  const apiKey = process.env.API_KEY || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

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
    "Post text to social media (X/Twitter, 小红书, 即刻). " +
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
    },
    required: ["platform", "text"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const platformKey = input.platform as string;
    const text = input.text as string;

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

    // 5. Click submit
    steps.push({
      action: "click",
      args: { selector: config.submitSelector, timeout: 10000 },
    });

    // 6. Wait for submission
    if (config.submitWait) {
      steps.push({ action: "sleep", args: { ms: config.submitWait } });
    }

    // 7. Screenshot for confirmation
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

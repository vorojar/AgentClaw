import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import type { Tool, ToolResult } from "@agentclaw/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 50_000;
const SCREENSHOT_DIR = resolve(process.cwd(), "data", "tmp");
const DEFAULT_NAVIGATION_TIMEOUT = 30_000;
const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/** CDP connection to the user's real browser */
let browser: Browser | null = null;
/** The tab we manage (created by us, not hijacking user's tabs) */
let page: Page | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Detect a usable Chrome / Edge executable on the current platform. */
function detectBrowserPath(): string | undefined {
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    );
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Connect to the user's real Chrome/Edge via CDP.
 *
 * 1. Try connecting to an already-running CDP endpoint.
 * 2. If unavailable, launch Chrome with --remote-debugging-port so we
 *    attach to the user's real profile (passwords, cookies, extensions).
 */
async function ensureConnected(): Promise<Browser> {
  if (browser?.connected) return browser;

  // Reset stale state
  browser = null;
  page = null;

  // 1. Try connecting to existing CDP
  try {
    browser = await puppeteer.connect({ browserURL: CDP_URL });
    console.log("[browser] Connected to existing Chrome CDP");
    return browser;
  } catch {
    // Not available — launch Chrome ourselves
  }

  // 2. Launch Chrome with CDP enabled
  const executablePath = detectBrowserPath();
  if (!executablePath) {
    throw new Error(
      "找不到 Chrome 或 Edge。请安装 Google Chrome 或 Microsoft Edge。",
    );
  }

  console.log(`[browser] Launching Chrome with CDP on port ${CDP_PORT}...`);
  const child = spawn(
    executablePath,
    [`--remote-debugging-port=${CDP_PORT}`],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  // 3. Wait for CDP to become available
  for (let i = 0; i < 15; i++) {
    await sleep(500);
    try {
      browser = await puppeteer.connect({ browserURL: CDP_URL });
      console.log("[browser] Connected to Chrome CDP");
      return browser;
    } catch {
      // not ready yet
    }
  }

  throw new Error(
    "无法连接到 Chrome 调试端口。如果 Chrome 已在运行，请先关闭所有 Chrome 窗口后重试。",
  );
}

/** Get or create our managed tab. */
async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  const b = await ensureConnected();
  page = await b.newPage();
  page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT);
  return page;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleOpen(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const url = input.url as string | undefined;
  if (!url) {
    return { content: "Missing required parameter: url", isError: true };
  }

  const p = await ensurePage();
  await p.goto(url, { waitUntil: "domcontentloaded" });
  const title = await p.title();

  return {
    content: `Opened page: ${title}\nURL: ${p.url()}`,
    isError: false,
    metadata: { title, url: p.url() },
  };
}

async function handleScreenshot(): Promise<ToolResult> {
  if (!page || page.isClosed()) {
    return {
      content: "No page open. Use the 'open' action first.",
      isError: true,
    };
  }

  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  } catch {
    // may already exist
  }

  const timestamp = Date.now();
  const filePath = resolve(
    SCREENSHOT_DIR,
    `browser_screenshot_${timestamp}.png`,
  );

  await page.screenshot({ path: filePath, fullPage: false });

  return {
    content: `Screenshot saved to: ${filePath}`,
    isError: false,
    metadata: { filePath },
  };
}

async function handleClick(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (!page || page.isClosed()) {
    return {
      content: "No page open. Use the 'open' action first.",
      isError: true,
    };
  }

  const selector = input.selector as string | undefined;
  if (!selector) {
    return { content: "Missing required parameter: selector", isError: true };
  }

  try {
    await page.waitForSelector(selector, { timeout: 5_000 });
    await page.click(selector);
    return { content: `Clicked element: ${selector}`, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to click "${selector}": ${message}`,
      isError: true,
    };
  }
}

async function handleType(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (!page || page.isClosed()) {
    return {
      content: "No page open. Use the 'open' action first.",
      isError: true,
    };
  }

  const selector = input.selector as string | undefined;
  const text = input.text as string | undefined;
  if (!selector) {
    return { content: "Missing required parameter: selector", isError: true };
  }
  if (!text) {
    return { content: "Missing required parameter: text", isError: true };
  }

  try {
    await page.waitForSelector(selector, { timeout: 5_000 });
    await page.type(selector, text);
    return {
      content: `Typed text into element: ${selector}`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to type into "${selector}": ${message}`,
      isError: true,
    };
  }
}

async function handleGetContent(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  if (!page || page.isClosed()) {
    return {
      content: "No page open. Use the 'open' action first.",
      isError: true,
    };
  }

  const selector = input.selector as string | undefined;

  try {
    let text: string;

    if (selector) {
      await page.waitForSelector(selector, { timeout: 5_000 });
      text = await page.$eval(
        selector,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (el: any) => el.innerText ?? el.textContent ?? "",
      );
    } else {
      text = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (globalThis as any).document.body.innerText,
      );
    }

    const truncated = text.length > MAX_CONTENT_LENGTH;
    if (truncated) {
      text = text.slice(0, MAX_CONTENT_LENGTH) + "\n\n... [truncated]";
    }

    return {
      content: text,
      isError: false,
      metadata: { truncated, selector: selector ?? "body" },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to get content${selector ? ` for "${selector}"` : ""}: ${message}`,
      isError: true,
    };
  }
}

async function handleClose(): Promise<ToolResult> {
  // Only close our managed tab, NOT the whole browser
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
  page = null;

  // Disconnect CDP (browser keeps running)
  if (browser) {
    browser.disconnect();
    browser = null;
  }

  return { content: "Tab closed.", isError: false };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const browserTool: Tool = {
  name: "browser",
  description:
    "Control the user's real Chrome/Edge browser via CDP. Opens pages in a new tab " +
    "within the user's actual browser (with all their logins, cookies, passwords, extensions). " +
    "Supports: open, screenshot, click, type, get_content, close.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "The action to perform: open, screenshot, click, type, get_content, close",
      },
      url: {
        type: "string",
        description: "URL to open (for 'open' action)",
      },
      selector: {
        type: "string",
        description:
          "CSS selector (for 'click', 'type', 'get_content' actions)",
      },
      text: {
        type: "string",
        description: "Text to type (for 'type' action)",
      },
    },
    required: ["action"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;

    try {
      switch (action) {
        case "open":
          return await handleOpen(input);
        case "screenshot":
          return await handleScreenshot();
        case "click":
          return await handleClick(input);
        case "type":
          return await handleType(input);
        case "get_content":
          return await handleGetContent(input);
        case "close":
          return await handleClose();
        default:
          return {
            content: `Unknown action: "${action}". Supported: open, screenshot, click, type, get_content, close`,
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Browser action "${action}" failed: ${message}`,
        isError: true,
      };
    }
  },
};

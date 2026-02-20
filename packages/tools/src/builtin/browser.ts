import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import type { Tool, ToolResult } from "@agentclaw/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 50_000;
const SCREENSHOT_DIR = resolve(process.cwd(), "data", "tmp");
const DEFAULT_NAVIGATION_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Singleton browser state
// ---------------------------------------------------------------------------

let browser: Browser | null = null;
let page: Page | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    // Linux
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return undefined;
}

/** Ensure the browser and page singletons are running. */
async function ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
  if (browser && page) {
    // Verify the browser is still connected
    if (browser.connected) {
      return { browser, page };
    }
    // Browser disconnected — reset state
    browser = null;
    page = null;
  }

  const executablePath = detectBrowserPath();
  if (!executablePath) {
    throw new Error(
      "Could not find Chrome or Edge on this system. " +
        "Please install Google Chrome or Microsoft Edge and try again.",
    );
  }

  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const pages = await browser.pages();
  page = pages.length > 0 ? pages[0]! : await browser.newPage();
  page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT);

  return { browser, page };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleOpen(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input.url as string | undefined;
  if (!url) {
    return { content: "Missing required parameter: url", isError: true };
  }

  const { page: p } = await ensureBrowser();
  await p.goto(url, { waitUntil: "domcontentloaded" });
  const title = await p.title();

  return {
    content: `Opened page: ${title}\nURL: ${p.url()}`,
    isError: false,
    metadata: { title, url: p.url() },
  };
}

async function handleScreenshot(): Promise<ToolResult> {
  if (!page || !browser?.connected) {
    return {
      content: "Browser is not open. Use the 'open' action first.",
      isError: true,
    };
  }

  // Ensure screenshot directory exists
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
  if (!page || !browser?.connected) {
    return {
      content: "Browser is not open. Use the 'open' action first.",
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
    return {
      content: `Clicked element: ${selector}`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to click "${selector}": ${message}`,
      isError: true,
    };
  }
}

async function handleType(input: Record<string, unknown>): Promise<ToolResult> {
  if (!page || !browser?.connected) {
    return {
      content: "Browser is not open. Use the 'open' action first.",
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
  if (!page || !browser?.connected) {
    return {
      content: "Browser is not open. Use the 'open' action first.",
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
  if (!browser) {
    return { content: "Browser is already closed.", isError: false };
  }

  try {
    await browser.close();
  } catch {
    // ignore close errors
  }

  browser = null;
  page = null;

  return { content: "Browser closed.", isError: false };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const browserTool: Tool = {
  name: "browser",
  description:
    "Control a web browser to open pages, take screenshots, click elements, type text, and extract content. Uses the system's installed Chrome or Edge browser.",
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
            content: `Unknown action: "${action}". Supported actions: open, screenshot, click, type, get_content, close`,
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

import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdirSync, existsSync, readdirSync } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * Browser CDP tool — uses Playwright's CDP connection for browser automation.
 * Requires `playwright-core` to be installed.
 */

// Lazy-loaded playwright — use `any` to avoid importing types at module level
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pw: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let defaultContext: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activePage: any = null;

const PROFILE_DIR = join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".agentclaw",
  "browser",
).replace(/\\/g, "/");

const STATES_DIR = join(process.cwd(), "data", "browser-states").replace(
  /\\/g,
  "/",
);

async function loadPlaywright(): Promise<void> {
  if (pw) return;
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error(
      "playwright-core is not installed. Run: pnpm add playwright-core",
    );
  }
}

/** Find Chrome/Chromium executable path */
function findChromePath(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
          ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureBrowser(): Promise<any> {
  if (activePage) {
    try {
      // Check if page is still alive
      await activePage.title();
      return activePage;
    } catch {
      activePage = null;
    }
  }

  await loadPlaywright();
  const chromePath = findChromePath();

  if (!chromePath) {
    throw new Error(
      "Chrome not found. Please install Google Chrome or set the path manually.",
    );
  }

  mkdirSync(PROFILE_DIR, { recursive: true });
  const debugPort = 9222;

  try {
    browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  } catch {
    // Launch new Chrome instance with remote debugging
    execFileAsync(
      chromePath,
      [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${PROFILE_DIR}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { windowsHide: false },
    ).catch(() => {
      /* Chrome stays running */
    });

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        browser = await pw.chromium.connectOverCDP(
          `http://127.0.0.1:${debugPort}`,
        );
        break;
      } catch {
        if (i === 9)
          throw new Error("Failed to connect to Chrome via CDP after 5s");
      }
    }
  }

  if (!browser) throw new Error("Browser connection failed");

  const contexts = browser.contexts();
  defaultContext = contexts[0] || (await browser.newContext());
  const pages = defaultContext.pages();
  activePage = pages[0] || (await defaultContext.newPage());

  return activePage;
}

/**
 * Generate a DOM-based accessibility snapshot by evaluating JS in the page.
 * Tags interactive elements with data-ac-ref and returns a text tree.
 */
async function generateSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
): Promise<string> {
  // This script runs in the browser context
  const snapshot = (await page.evaluate(`
    (() => {
      // Clear old refs
      document.querySelectorAll('[data-ac-ref]').forEach(el => el.removeAttribute('data-ac-ref'));

      let refCounter = 0;
      const lines = [];
      const interactiveSelectors = [
        'button', 'a[href]', 'input:not([type="hidden"])', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]',
        '[role="radio"]', '[role="combobox"]', '[role="menuitem"]', '[role="tab"]',
        '[role="switch"]', '[role="slider"]', '[role="searchbox"]',
        '[contenteditable="true"]'
      ];

      // Tag interactive elements
      for (const sel of interactiveSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          if (!el.getAttribute('data-ac-ref') && el.offsetParent !== null) {
            refCounter++;
            el.setAttribute('data-ac-ref', 'e' + refCounter);
          }
        });
      }

      function walk(node, depth) {
        if (depth > 10) return; // safety limit
        const indent = '  '.repeat(depth);

        if (node.nodeType === 3) {
          // Text node
          const text = node.textContent.trim();
          if (text && text.length < 200) lines.push(indent + text);
          return;
        }

        if (node.nodeType !== 1) return;
        const el = node;
        const tag = el.tagName.toLowerCase();
        const ref = el.getAttribute('data-ac-ref');
        const role = el.getAttribute('role') || '';

        // Skip hidden elements
        if (el.offsetParent === null && tag !== 'body' && tag !== 'html') return;
        if (el.getAttribute('aria-hidden') === 'true') return;

        // Headings
        if (/^h[1-6]$/.test(tag)) {
          const level = parseInt(tag[1]);
          lines.push(indent + '#'.repeat(level) + ' ' + el.textContent.trim().slice(0, 100));
          return;
        }

        // Interactive element with ref
        if (ref) {
          const name = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 60) || '';
          const type = el.getAttribute('type') || '';
          const value = el.value !== undefined && el.value !== '' ? ' value="' + String(el.value).slice(0, 40) + '"' : '';
          const roleStr = role || tag;
          lines.push(indent + '[' + ref + '] ' + roleStr + (type ? '[' + type + ']' : '') + ' "' + name + '"' + value);
          return;
        }

        // Skip structural-only tags
        const skip = new Set(['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link', 'br', 'hr']);
        if (skip.has(tag)) return;

        // Non-interactive element with role or semantic tag
        if (role && role !== 'none' && role !== 'generic' && role !== 'presentation') {
          const name = el.getAttribute('aria-label') || '';
          if (name) lines.push(indent + role + ': ' + name);
        }

        // Recurse into children
        for (const child of el.childNodes) {
          walk(child, depth + 1);
        }
      }

      walk(document.body, 0);
      return lines.join('\\n');
    })()
  `)) as string;

  return snapshot || "(empty page)";
}

function listStateFiles(): string[] {
  try {
    if (!existsSync(STATES_DIR)) return [];
    return readdirSync(STATES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export const browserCdpTool: Tool = {
  name: "browser_cdp",
  category: "builtin",
  description:
    "Browser automation via Chrome CDP (Playwright). " +
    "Actions: navigate, snapshot, click, type, screenshot, tabs, evaluate, wait, close, save_state, load_state, list_states.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "Action: navigate | snapshot | click | type | screenshot | tabs | evaluate | wait | close | save_state | load_state | list_states",
        enum: [
          "navigate",
          "snapshot",
          "click",
          "type",
          "screenshot",
          "tabs",
          "evaluate",
          "wait",
          "close",
          "save_state",
          "load_state",
          "list_states",
        ],
      },
      url: {
        type: "string",
        description: "URL to navigate to (for navigate action)",
      },
      ref: {
        type: "string",
        description: "Element ref ID from snapshot, e.g. 'e1' (for click/type)",
      },
      text: {
        type: "string",
        description:
          "Text to type (for type action) or text to wait for (for wait action)",
      },
      code: {
        type: "string",
        description:
          "JavaScript code to evaluate in the page (for evaluate action)",
      },
      name: {
        type: "string",
        description:
          "State name for save_state/load_state, e.g. 'xiaohongshu', 'x-com', 'jike'",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
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
        case "navigate": {
          const url = input.url as string;
          if (!url) return { content: "Missing url parameter", isError: true };
          const page = await ensureBrowser();
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: (input.timeout as number) ?? 30000,
          });
          const title = await page.title();
          return {
            content: `Navigated to: ${page.url()}\nTitle: ${title}`,
            isError: false,
          };
        }

        case "snapshot": {
          const page = await ensureBrowser();
          const snapshot = await generateSnapshot(page);
          const url = page.url();
          const title = await page.title();
          return {
            content: `URL: ${url}\nTitle: ${title}\n\n${snapshot}`,
            isError: false,
          };
        }

        case "click": {
          const ref = input.ref as string;
          if (!ref) return { content: "Missing ref parameter", isError: true };
          const page = await ensureBrowser();
          await generateSnapshot(page); // tag elements
          await page.click(`[data-ac-ref="${ref}"]`, {
            timeout: (input.timeout as number) ?? 5000,
          });
          return { content: `Clicked element [${ref}]`, isError: false };
        }

        case "type": {
          const ref = input.ref as string;
          const text = input.text as string;
          if (!ref || !text)
            return {
              content: "Missing ref or text parameter",
              isError: true,
            };
          const page = await ensureBrowser();
          await generateSnapshot(page); // tag elements
          await page.fill(`[data-ac-ref="${ref}"]`, text, {
            timeout: (input.timeout as number) ?? 5000,
          });
          return {
            content: `Typed "${text}" into element [${ref}]`,
            isError: false,
          };
        }

        case "screenshot": {
          const page = await ensureBrowser();
          const workDir =
            context?.workDir ||
            join(process.cwd(), "data", "tmp").replace(/\\/g, "/");
          mkdirSync(workDir, { recursive: true });
          const filename = `screenshot_${Date.now()}.png`;
          const filePath = join(workDir, filename).replace(/\\/g, "/");
          await page.screenshot({ path: filePath, fullPage: false });
          return {
            content: `Screenshot saved: ${filePath}`,
            isError: false,
            metadata: { filePath },
          };
        }

        case "tabs": {
          const page = await ensureBrowser();
          const ctx = page.context();
          const pages = ctx.pages();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lines = pages.map((p: any, i: number) => {
            const current = p === activePage ? " (active)" : "";
            return `${i}: ${p.url()}${current}`;
          });
          return {
            content: `Tabs (${pages.length}):\n${lines.join("\n")}`,
            isError: false,
          };
        }

        case "evaluate": {
          const code = input.code as string;
          if (!code)
            return { content: "Missing code parameter", isError: true };
          const page = await ensureBrowser();
          const result = await page.evaluate(code);
          return {
            content: JSON.stringify(result, null, 2) ?? "(undefined)",
            isError: false,
          };
        }

        case "wait": {
          const text = input.text as string;
          const timeout = (input.timeout as number) ?? 30000;
          const page = await ensureBrowser();
          if (text) {
            await page.waitForSelector(`text=${text}`, { timeout });
            return {
              content: `Text "${text}" appeared on page`,
              isError: false,
            };
          }
          await page.waitForTimeout(Math.min(timeout, 5000));
          return { content: "Wait completed", isError: false };
        }

        case "save_state": {
          const name = input.name as string;
          if (!name)
            return { content: "Missing name parameter", isError: true };
          const page = await ensureBrowser();
          const ctx = page.context();
          mkdirSync(STATES_DIR, { recursive: true });
          const statePath = join(STATES_DIR, `${name}.json`).replace(
            /\\/g,
            "/",
          );
          await ctx.storageState({ path: statePath });
          return {
            content: `Login state saved: ${statePath}\nThis state contains cookies and localStorage for all tabs in the current context.\nUse load_state with name="${name}" to restore it later.`,
            isError: false,
          };
        }

        case "load_state": {
          const name = input.name as string;
          if (!name)
            return { content: "Missing name parameter", isError: true };
          const statePath = join(STATES_DIR, `${name}.json`).replace(
            /\\/g,
            "/",
          );
          if (!existsSync(statePath))
            return {
              content: `State file not found: ${statePath}\nAvailable states: ${listStateFiles().join(", ") || "(none)"}`,
              isError: true,
            };
          // Close existing browser and relaunch with saved state
          if (browser) {
            await browser.close().catch(() => {});
            browser = null;
            defaultContext = null;
            activePage = null;
          }
          await loadPlaywright();
          const chromePath = findChromePath();
          if (!chromePath)
            return { content: "Chrome not found", isError: true };
          // Launch with Playwright (not CDP) to apply storageState
          browser = await pw.chromium.launch({
            executablePath: chromePath,
            headless: false,
            args: ["--no-first-run", "--no-default-browser-check"],
          });
          defaultContext = await browser.newContext({
            storageState: statePath,
          });
          activePage = await defaultContext.newPage();
          return {
            content: `Login state loaded: ${name}\nBrowser launched with saved cookies and localStorage. Navigate to the target site to use the login session.`,
            isError: false,
          };
        }

        case "list_states": {
          const states = listStateFiles();
          if (states.length === 0)
            return {
              content:
                "No saved states.\nUse save_state after logging into a site to save the session.",
              isError: false,
            };
          return {
            content: `Saved states (${states.length}):\n${states.map((s) => `  - ${s}`).join("\n")}\n\nUse load_state with the name to restore a session.`,
            isError: false,
          };
        }

        case "close": {
          if (browser) {
            await browser.close().catch(() => {});
            browser = null;
            defaultContext = null;
            activePage = null;
          }
          return { content: "Browser closed", isError: false };
        }

        default:
          return {
            content: `Unknown action: ${action}. Valid: navigate, snapshot, click, type, screenshot, tabs, evaluate, wait, close`,
            isError: true,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Browser error: ${msg}`, isError: true };
    }
  },
};

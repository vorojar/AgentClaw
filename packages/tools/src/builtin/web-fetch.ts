import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const execFileAsync = promisify(execFile);

// ── 站点配置：从 sites.json 加载，缺失时用内置默认值 ──

interface SiteConfig {
  spaDomains: string[];
  loginWallKeywords: string[];
  noisePatterns: string[];
  sites: Record<string, { selector?: string; cleanupJs?: string; $ref?: string }>;
}

function loadSiteConfig(): SiteConfig {
  const configPath = resolve(process.cwd(), "skills/web-fetch/sites.json");
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    }
  } catch (err) {
    console.warn("[web_fetch] Failed to load sites.json, using defaults:", err);
  }
  // 内置默认值（与 sites.json 同步）
  return {
    spaDomains: [
      "x.com", "twitter.com", "zhihu.com", "www.zhihu.com",
      "weibo.com", "m.weibo.com", "bilibili.com", "www.bilibili.com",
      "douyin.com", "www.douyin.com", "xiaohongshu.com", "www.xiaohongshu.com",
      "threads.net", "www.threads.net", "reddit.com", "www.reddit.com",
      "feishu.cn", "www.feishu.cn", "larksuite.com", "www.larksuite.com",
      "chatgpt.com", "chat.openai.com",
    ],
    loginWallKeywords: [
      "安全验证", "请登录", "请先登录",
      "当前环境异常", "完成验证后即可继续访问", "requiring CAPTCHA",
      "login required", "sign in to", "please log in", "access denied",
    ],
    noisePatterns: [
      "^Don't miss what's happening$",
      "^People on X are the first to know\\.?$",
      "^\\[Log in\\].*$", "^\\[Sign up\\].*$",
      "^See new posts?$", "^## Article$", "^# Conversation$",
      "^Discover more$", "^Trending now$",
      "^Terms of Service", "^Privacy Policy", "^Cookie Policy",
      "^\\[.*?\\]\\(\\/login\\)$", "^\\[.*?\\]\\(\\/i\\/flow\\/signup\\)$",
      "^Show more$", "^Show this thread$",
    ],
    sites: {},
  };
}

const siteConfig = loadSiteConfig();

/** 内部硬上限：防止极端页面撑爆内存（溢出模式会在 8K 处接管 LLM 上下文保护） */
const INTERNAL_MAX_LENGTH = 200_000;
const FETCH_TIMEOUT = 10_000;
/** Jina Reader 超时（毫秒）——比主 fetch 短，失败时快速 fallback */
const JINA_TIMEOUT = 8_000;
/** Playwright 子进程超时（毫秒） */
const PLAYWRIGHT_TIMEOUT = 30_000;
/** Playwright 子进程最大输出（字节） */
const PLAYWRIGHT_MAX_BUFFER = 2 * 1024 * 1024;
const DEFAULT_PROMPT_MAX_CHARS = 3_500;
const MIN_PROMPT_MAX_CHARS = 1_000;
const MAX_PROMPT_MAX_CHARS = 20_000;

/** 已知 SPA/JS 渲染站点——命中时直接走 Playwright，不判断内容长度 */
const SPA_DOMAINS = new Set(siteConfig.spaDomains);

/** 登录墙关键词——命中任一则提示用户需要登录态 */
const LOGIN_WALL_KEYWORDS = siteConfig.loginWallKeywords;

/** 微信公众号文章直连能拿到正文，Jina Reader 经常只返回微信验证页 */
function isWeixinArticleHost(hostname: string): boolean {
  return hostname === "mp.weixin.qq.com";
}

function isFeishuDocHost(hostname: string): boolean {
  return (
    hostname === "feishu.cn" ||
    hostname.endsWith(".feishu.cn") ||
    hostname === "larksuite.com" ||
    hostname.endsWith(".larksuite.com")
  );
}

function normalizeXArticleUrl(url: URL): string | null {
  if (url.hostname !== "x.com" && url.hostname !== "twitter.com") {
    return null;
  }
  const match = url.pathname.match(/^\/([^/]+)\/article\/(\d+)(?:\/)?$/);
  if (!match) return null;
  return `${url.protocol}//${url.hostname}/${match[1]}/status/${match[2]}`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isBlockedContent(content: string): boolean {
  const lower = content.toLowerCase();
  if (LOGIN_WALL_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) {
    return true;
  }

  const compact = content.replace(/\s+/g, "");
  return (
    compact.includes("当前环境异常") ||
    compact.includes("完成验证后即可继续访问") ||
    (compact.includes("环境异常") && compact.includes("去验证")) ||
    (lower.includes("something went wrong") &&
      lower.includes("try reloading")) ||
    (lower.includes("join today") &&
      lower.includes("create account") &&
      lower.includes("sign in")) ||
    lower.includes("requiring captcha")
  );
}

/** Check if hostname resolves to a private/internal address (SSRF protection) */
function isPrivateHost(hostname: string): boolean {
  // Reject localhost variants
  if (hostname === "localhost" || hostname === "[::1]" || hostname === "0.0.0.0") return true;
  // IPv4 private ranges
  const parts = hostname.split(".").map(Number);
  if (parts.length === 4 && parts.every(n => !isNaN(n))) {
    if (parts[0] === 127) return true;                    // 127.0.0.0/8
    if (parts[0] === 10) return true;                     // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16
    if (parts[0] === 0) return true;                       // 0.0.0.0/8
  }
  return false;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

/** Lines commonly found in SPA page chrome (navigation, login prompts, etc.) */
const NOISE_PATTERNS = siteConfig.noisePatterns.map((p) => new RegExp(p, "i"));

/** Remove common SPA navigation noise from markdown output */
function cleanMarkdown(md: string): string {
  return md
    .split("\n")
    .filter((line) => !NOISE_PATTERNS.some((p) => p.test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readPromptMaxChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PROMPT_MAX_CHARS;
  }
  return Math.max(
    MIN_PROMPT_MAX_CHARS,
    Math.min(MAX_PROMPT_MAX_CHARS, Math.floor(value)),
  );
}

function compactFetchedContent(
  content: string,
  url: string,
  maxChars: number,
): { content: string; compacted: boolean; originalLength: number } {
  const originalLength = content.length;
  const normalized = content.replace(/\n{3,}/g, "\n\n").trim();
  const hasUrlSource = /^URL Source:/m.test(normalized);
  const header = hasUrlSource ? "" : `URL Source: ${url}\n\n`;
  const budget = Math.max(500, maxChars - header.length - 120);
  if (normalized.length + header.length <= maxChars) {
    return {
      content: `${header}${normalized}`.trim(),
      compacted: false,
      originalLength,
    };
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^!\[/.test(line));
  const selected: string[] = [];
  let used = 0;
  for (const line of lines) {
    const isHighSignal =
      /^#/.test(line) ||
      /^Title:/i.test(line) ||
      /^URL Source:/i.test(line) ||
      /^Published Time:/i.test(line) ||
      /^Date:/i.test(line) ||
      line.length >= 40;
    if (!isHighSignal) continue;
    const next = line.length + 1;
    if (used + next > budget) break;
    selected.push(line);
    used += next;
  }

  const body = selected.join("\n").slice(0, budget).trim();
  return {
    content:
      `${header}${body}\n\n[content compacted] original ${originalLength} chars, returned <= ${maxChars} chars`.trim(),
    compacted: true,
    originalLength,
  };
}

/** Convert HTML to Markdown: Readability extracts article → turndown converts, fallback to full-page */
function htmlToMarkdown(html: string, _url?: string): string {
  // Try Readability first for article extraction
  try {
    const { document } = parseHTML(html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new Readability(document as any, { charThreshold: 100 });
    const article = reader.parse();
    if (article?.content && (article.textContent?.length ?? 0) > 200) {
      const title = article.title ? `# ${article.title}\n\n` : "";
      const md = turndown.turndown(article.content);
      return cleanMarkdown(title + md);
    }
  } catch {
    // Readability failed, fall through to full-page conversion
  }

  // Fallback: full-page turndown with basic noise removal
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  html = html.replace(/<nav[\s\S]*?<\/nav>/gi, "");

  const md = turndown.turndown(html);
  return cleanMarkdown(md);
}

function weixinArticleHtmlToMarkdown(html: string): string | null {
  try {
    const { document } = parseHTML(html);
    const contentEl = document.querySelector("#js_content");
    const text = normalizeText(contentEl?.textContent ?? "");
    if (!contentEl || text.length < 20) {
      return null;
    }

    const titleText = normalizeText(
      document.querySelector("#activity-name")?.textContent ??
        document.querySelector("meta[property='og:title']")?.getAttribute("content") ??
        document.querySelector("title")?.textContent ??
        "",
    );
    const title = titleText ? `# ${titleText}\n\n` : "";
    return cleanMarkdown(title + turndown.turndown(contentEl.innerHTML));
  } catch {
    return null;
  }
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch URL content as text (HTML auto-converted). Handles JS-rendered sites (x.com, zhihu, weibo, bilibili etc.) via Playwright fallback. Use save_as to save content directly as a file (skips LLM rewriting). Combine with auto_send to deliver the file to the user in one step.",
  category: "builtin",
  pure: true,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      save_as: {
        type: "string",
        description:
          "Save fetched content to this filename (e.g. 'article.md'). The framework writes the file directly — no need to call file_write separately.",
      },
      auto_send: {
        type: "boolean",
        description:
          "When used with save_as, automatically send the saved file to the user. No need for a separate send_file call.",
      },
      max_chars: {
        type: "number",
        description:
          "Maximum characters returned to the LLM prompt for normal fetches. Full content is still used for save_as. Default 3500.",
      },
    },
    required: ["url"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const requestedUrl = input.url as string;
    const saveAs = input.save_as as string | undefined;
    const autoSend = input.auto_send === true || String(input.auto_send).toLowerCase() === "true";
    const promptMaxChars = readPromptMaxChars(input.max_chars);

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(requestedUrl);
    } catch {
      return {
        content: `Invalid URL: ${requestedUrl}`,
        isError: true,
      };
    }
    const normalizedUrl = normalizeXArticleUrl(parsedUrl);
    const url = normalizedUrl ?? requestedUrl;
    if (normalizedUrl) {
      parsedUrl = new URL(normalizedUrl);
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return {
        content: `Unsupported protocol: ${parsedUrl.protocol} — only http and https are supported`,
        isError: true,
      };
    }

    if (isPrivateHost(parsedUrl.hostname)) {
      return {
        content: `Blocked: ${parsedUrl.hostname} is a private/internal address`,
        isError: true,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });

      if (!response.ok) {
        return {
          content: `HTTP ${response.status} ${response.statusText} for ${url}`,
          isError: true,
          metadata: { status: response.status, url },
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();

      let content: string;
      // 标记最终采用的抓取策略
      let strategy: "native" | "jina" | "playwright" | "login_wall" = "native";

      const isJsonResponse = contentType.includes("application/json");
      if (isJsonResponse) {
        // Pretty-print JSON
        try {
          const parsed = JSON.parse(body);
          content = JSON.stringify(parsed, null, 2);
        } catch {
          content = body;
        }
      } else if (contentType.includes("text/html")) {
        const nativeContent = isWeixinArticleHost(parsedUrl.hostname)
          ? (weixinArticleHtmlToMarkdown(body) ?? htmlToMarkdown(body))
          : htmlToMarkdown(body);

        // 优先 Jina Reader（Markdown 质量更高），但微信公众号直连正文更可靠，且 Jina
        // 对微信常返回“环境异常/验证码”页面，不能把它当成功内容。
        const isFeishuDoc = isFeishuDocHost(parsedUrl.hostname);
        if (isWeixinArticleHost(parsedUrl.hostname) || isFeishuDoc) {
          content = nativeContent;
        } else {
          const jina = await tryJinaReader(url);
          content = jina ?? nativeContent;
          if (jina) strategy = "jina";
        }

        // SPA 自动回退：已知 SPA 域名直接走 Playwright；其他站点内容极少时也降级
        // Jina 已成功且内容充足时跳过 Playwright
        const isSPADomain = SPA_DOMAINS.has(parsedUrl.hostname) || isFeishuDoc;
        if (strategy !== "jina" && (isSPADomain || (content.length < 1500 && body.length > 2000))) {
          // 直接带 --scroll 抓取，避免两次 Playwright 启动开销
          const pwContent = await tryPlaywrightFetch(url, true);
          if (pwContent !== null && pwContent.length >= 500) {
            content = pwContent;
            strategy = "playwright";
          } else if (pwContent === null || pwContent.length < 500) {
            content +=
              "\n\n[注意] 此页面需要 JS 渲染，静态抓取内容不完整。请改用 agent-browser 技能获取：use_skill('agent-browser')，然后用 agent-browser open + snapshot/get text 获取完整内容。";
          }
        }

      } else {
        // Plain text or other text formats
        content = body;
      }

      // 验证页/登录墙必须在保存和自动发送前硬拦截，避免把错误页面交付给用户。
      if (!isJsonResponse && isBlockedContent(content)) {
        strategy = "login_wall";
        return {
          content:
            `无法抓取完整内容：${requestedUrl} 需要验证或登录态。` +
            "请使用 browser/Chrome 登录态抓取，或在验证完成后重试。",
          isError: true,
          metadata: {
            url: requestedUrl,
            ...(normalizedUrl ? { normalizedUrl } : {}),
            strategy,
            status: response.status,
            contentType,
            blocked: true,
          },
        };
      }

      // ── save_as: write content to file directly (skip LLM rewriting) ──
      if (saveAs) {
        const workDir =
          context?.workDir ??
          join(resolve(process.cwd(), "data", "tmp"), `fetch_${Date.now()}`);
        mkdirSync(workDir, { recursive: true });
        const filePath = join(workDir, basename(saveAs));
        writeFileSync(filePath, content, "utf-8");

        // auto_send: deliver file to user immediately
        if (autoSend && context?.sendFile) {
          try {
            await context.sendFile(filePath, basename(saveAs));
            return {
              content: `Fetched and sent: ${basename(saveAs)} (${content.length} chars from ${url})`,
              isError: false,
              autoComplete: true,
              metadata: {
                url: requestedUrl,
                ...(normalizedUrl ? { normalizedUrl } : {}),
                strategy,
                filePath,
                saved: true,
                sent: true,
              },
              effect: {
                kind: "send",
                target: filePath,
                reversible: false,
                deliverable: true,
                verified: true,
              },
            };
          } catch {
            // sendFile failed, fall through to saved-only response
          }
        }

        // Truncate content for LLM context (file has full content)
        const preview =
          content.length > 500
            ? `${content.slice(0, 500)}\n\n... [full content saved to file]`
            : content;
        return {
          content: `Saved to ${basename(saveAs)} (${content.length} chars).\n\nPreview:\n${preview}`,
          isError: false,
          metadata: {
            url: requestedUrl,
            ...(normalizedUrl ? { normalizedUrl } : {}),
            strategy,
            filePath,
            saved: true,
            originalLength: content.length,
          },
          effect: {
            kind: "write",
            target: filePath,
            reversible: true,
            verified: true,
          },
        };
      }

      // 内部硬上限：防止极端页面撑爆进程内存（溢出模式在 agent-loop 层处理 LLM 上下文）
      if (content.length > INTERNAL_MAX_LENGTH) {
        content = `${content.slice(0, INTERNAL_MAX_LENGTH)}\n\n... [truncated at internal safety limit]`;
      }

      const originalLengthBeforePromptCompaction = content.length;
      const promptContent = isJsonResponse
        ? {
            content,
            compacted: false,
            originalLength: originalLengthBeforePromptCompaction,
          }
        : compactFetchedContent(content, url, promptMaxChars);

      const guidance =
        "hint: if this content contains the requested facts, synthesize the final answer now with this URL as source; use file_write only when saving is requested, and search more only if key facts are missing.";

      return {
        content: isJsonResponse
          ? promptContent.content
          : `${promptContent.content}\n\n${guidance}`,
        isError: false,
        metadata: {
          url: requestedUrl,
          ...(normalizedUrl ? { normalizedUrl } : {}),
          strategy,
          status: response.status,
          contentType,
          originalLength: originalLengthBeforePromptCompaction,
          returnedLength: isJsonResponse ? content.length : promptContent.content.length,
          compacted: isJsonResponse ? false : promptContent.compacted,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          content: `Request timed out after ${FETCH_TIMEOUT}ms for ${url}`,
          isError: true,
          metadata: { url, timedOut: true },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Failed to fetch ${url}: ${message}`,
        isError: true,
        metadata: { url },
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * 尝试调用 Playwright 脚本抓取页面内容。
 * 如果 python 不在 PATH、fetch.py 不存在、或执行失败，静默返回 null（不影响主流程）。
 */
async function tryPlaywrightFetch(
  url: string,
  scroll = false,
): Promise<string | null> {
  const scriptPath = resolveWebFetchScriptPath();
  if (!existsSync(scriptPath)) {
    return null;
  }

  try {
    const args = [scriptPath, "--url", url];
    if (scroll) args.push("--scroll");
    const { stdout } = await execFileAsync("python", args, {
      timeout: scroll ? PLAYWRIGHT_TIMEOUT * 2 : PLAYWRIGHT_TIMEOUT,
      maxBuffer: PLAYWRIGHT_MAX_BUFFER,
      windowsHide: true,
    });
    const result = stdout.trim();
    if (!result || result.startsWith("Error loading page:")) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

function resolveWebFetchScriptPath(): string {
  let current = resolve(process.cwd());
  while (true) {
    const candidate = resolve(current, "skills/web-fetch/scripts/fetch.py");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return candidate;
    }
    current = parent;
  }
}

/**
 * 尝试通过 Jina Reader 获取 Markdown 内容。
 * 免费无需 API key，20 RPM 限制。失败时静默返回 null。
 */
async function tryJinaReader(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT);
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown" },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const text = (await resp.text()).trim();
    // Jina 返回空或极短内容时视为失败
    if (text.length < 100) return null;
    // Jina 自身遇到验证码/环境异常时，回退本机直连内容，不把验证页当成功正文。
    if (isBlockedContent(text)) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

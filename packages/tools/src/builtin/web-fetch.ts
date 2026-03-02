import type { Tool, ToolResult } from "@agentclaw/types";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_LENGTH = 10_000;
const FETCH_TIMEOUT = 10_000;
/** Playwright 子进程超时（毫秒） */
const PLAYWRIGHT_TIMEOUT = 30_000;
/** Playwright 子进程最大输出（字节） */
const PLAYWRIGHT_MAX_BUFFER = 2 * 1024 * 1024;

/** 已知 SPA/JS 渲染站点——命中时直接走 Playwright，不判断内容长度 */
const SPA_DOMAINS = new Set([
  "x.com", "twitter.com",
  "zhihu.com", "www.zhihu.com",
  "weibo.com", "m.weibo.com",
  "bilibili.com", "www.bilibili.com",
  "douyin.com", "www.douyin.com",
  "xiaohongshu.com", "www.xiaohongshu.com",
  "threads.net", "www.threads.net",
  "reddit.com", "www.reddit.com",
  "chatgpt.com", "chat.openai.com",
]);

/** 登录墙关键词——命中任一则提示用户需要登录态 */
const LOGIN_WALL_KEYWORDS = [
  "安全验证",
  "请登录",
  "登录后",
  "请先登录",
  "login required",
  "sign in to",
  "please log in",
  "access denied",
];

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

/** Convert HTML to Markdown: Readability extracts article → turndown converts, fallback to full-page */
function htmlToMarkdown(html: string, url?: string): string {
  // Try Readability first for article extraction
  try {
    const { document } = parseHTML(html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new Readability(document as any, { charThreshold: 100 });
    const article = reader.parse();
    if (article?.content && (article.textContent?.length ?? 0) > 200) {
      const title = article.title ? `# ${article.title}\n\n` : "";
      const md = turndown.turndown(article.content);
      return (title + md).replace(/\n{3,}/g, "\n\n").trim();
    }
  } catch {
    // Readability failed, fall through to full-page conversion
  }

  // Fallback: full-page turndown with basic noise removal
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  html = html.replace(/<nav[\s\S]*?<\/nav>/gi, "");

  const md = turndown.turndown(html);
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch URL content as text (HTML auto-converted).",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      max_length: { type: "number", default: 10000 },
    },
    required: ["url"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    const maxLength = (input.max_length as number) ?? DEFAULT_MAX_LENGTH;

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        content: `Invalid URL: ${url}`,
        isError: true,
      };
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return {
        content: `Unsupported protocol: ${parsedUrl.protocol} — only http and https are supported`,
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
      let strategy: "native" | "playwright" | "login_wall" = "native";

      if (contentType.includes("application/json")) {
        // Pretty-print JSON
        try {
          const parsed = JSON.parse(body);
          content = JSON.stringify(parsed, null, 2);
        } catch {
          content = body;
        }
      } else if (contentType.includes("text/html")) {
        content = htmlToMarkdown(body);

        // SPA 自动回退：已知 SPA 域名直接走 Playwright；其他站点内容极少时也降级
        const isSPADomain = SPA_DOMAINS.has(parsedUrl.hostname);
        if (isSPADomain || (content.length < 1500 && body.length > 2000)) {
          // 直接带 --scroll 抓取，避免两次 Playwright 启动开销
          const pwContent = await tryPlaywrightFetch(url, maxLength, true);
          if (pwContent !== null && pwContent.length >= 500) {
            content = pwContent;
            strategy = "playwright";
          } else if (pwContent === null) {
            content +=
              "\n\n[注意] 提取内容极少（JS 渲染页面），且 Playwright 降级失败。若 Playwright 未安装，请执行：pip install playwright && python -m playwright install chromium --with-deps";
          }
        }

        // 登录墙检测（对 native 和 playwright 结果都生效）
        if (
          LOGIN_WALL_KEYWORDS.some((kw) =>
            content.toLowerCase().includes(kw.toLowerCase()),
          )
        ) {
          strategy = "login_wall";
          content +=
            "\n\n[注意] 此页面需要登录态才能访问完整内容，建议使用 browser 技能（可利用用户的浏览器登录状态）。";
        }
      } else {
        // Plain text or other text formats
        content = body;
      }

      // Hint: content is already markdown, no need for LLM to rewrite
      if (content.length > 1000 && strategy !== "login_wall") {
        content += "\n\n[提示] 以上内容已为 Markdown 格式，可直接用 file_write 保存，无需重新整理。";
      }

      // Truncate if needed
      const truncated = content.length > maxLength;
      if (truncated) {
        content = content.slice(0, maxLength) + "\n\n... [truncated]";
      }

      return {
        content,
        isError: false,
        metadata: {
          url,
          strategy,
          status: response.status,
          contentType,
          truncated,
          originalLength: content.length,
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
  maxLength: number,
  scroll = false,
): Promise<string | null> {
  const scriptPath = resolve(process.cwd(), "skills/web-fetch/scripts/fetch.py");
  if (!existsSync(scriptPath)) {
    return null;
  }

  try {
    const args = [scriptPath, "--url", url, "--max-length", String(maxLength)];
    if (scroll) args.push("--scroll");
    const { stdout } = await execFileAsync("python", args, {
      timeout: scroll ? PLAYWRIGHT_TIMEOUT * 2 : PLAYWRIGHT_TIMEOUT,
      maxBuffer: PLAYWRIGHT_MAX_BUFFER,
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

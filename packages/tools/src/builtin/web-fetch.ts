import type { Tool, ToolResult } from "@agentclaw/types";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const DEFAULT_MAX_LENGTH = 10_000;
const FETCH_TIMEOUT = 10_000;

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
      } else {
        // Plain text or other text formats
        content = body;
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

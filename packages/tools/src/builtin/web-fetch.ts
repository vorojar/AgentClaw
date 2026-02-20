import type { Tool, ToolResult } from "@agentclaw/types";

const DEFAULT_MAX_LENGTH = 10_000;
const FETCH_TIMEOUT = 10_000;
const USER_AGENT =
  "AgentClaw/1.0 (https://github.com/agentclaw; compatible; Bot)";

/** Strip HTML to readable plain text */
function htmlToText(html: string): string {
  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Replace <br>, <p>, <div>, <li>, heading tags with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  text = text.replace(/<(p|div|h[1-6]|li|tr)[\s>]/gi, "\n");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse multiple blank lines and trim each line
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch content from a URL. Returns the page content as text. Supports HTML (auto-converts to readable text), JSON, and plain text.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
      max_length: {
        type: "number",
        description: "Maximum content length to return (default: 10000)",
      },
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
        headers: { "User-Agent": USER_AGENT },
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
        content = htmlToText(body);
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

import type { Tool, ToolResult } from "@agentclaw/types";

const DEFAULT_TIMEOUT = 30_000;
const MAX_BODY_LENGTH = 50_000;
const USER_AGENT =
  "AgentClaw/1.0 (https://github.com/agentclaw; compatible; Bot)";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
type HttpMethod = (typeof ALLOWED_METHODS)[number];

/** Headers to include in the response summary */
const IMPORTANT_HEADERS = [
  "content-type",
  "content-length",
  "location",
  "set-cookie",
  "www-authenticate",
  "retry-after",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "etag",
  "last-modified",
  "cache-control",
];

function pickResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of IMPORTANT_HEADERS) {
    const value = headers.get(key);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

function formatResponse(
  status: number,
  statusText: string,
  headers: Record<string, string>,
  body: string,
): string {
  const lines: string[] = [];
  lines.push(`HTTP ${status} ${statusText}`);

  // Response headers
  const headerEntries = Object.entries(headers);
  if (headerEntries.length > 0) {
    lines.push("");
    lines.push("Response Headers:");
    for (const [key, value] of headerEntries) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  // Response body
  lines.push("");
  lines.push("Body:");
  if (body.length === 0) {
    lines.push("  (empty)");
  } else {
    lines.push(body);
  }

  return lines.join("\n");
}

export const httpRequestTool: Tool = {
  name: "http_request",
  description: "Send an HTTP request. Returns status, headers, body.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        default: "GET",
      },
      headers: { type: "object" },
      body: { type: "string" },
      timeout: { type: "number", default: DEFAULT_TIMEOUT },
    },
    required: ["url"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    const method = (
      (input.method as string) ?? "GET"
    ).toUpperCase() as HttpMethod;
    const customHeaders = (input.headers as Record<string, string>) ?? {};
    const body = input.body as string | undefined;
    const timeout = (input.timeout as number) ?? DEFAULT_TIMEOUT;

    // Validate method
    if (!ALLOWED_METHODS.includes(method)) {
      return {
        content: `Unsupported HTTP method: ${method}. Allowed: ${ALLOWED_METHODS.join(", ")}`,
        isError: true,
      };
    }

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

    // Build request headers
    const reqHeaders: Record<string, string> = {
      "User-Agent": USER_AGENT,
      ...customHeaders,
    };

    // Build fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: reqHeaders,
      redirect: "follow",
    };

    // Attach body for methods that support it
    if (body !== undefined && method !== "GET") {
      fetchOptions.body = body;

      // Auto-set Content-Type to application/json if body looks like JSON
      // and Content-Type is not already set
      const hasContentType = Object.keys(reqHeaders).some(
        (key) => key.toLowerCase() === "content-type",
      );
      if (!hasContentType) {
        try {
          JSON.parse(body);
          reqHeaders["Content-Type"] = "application/json";
        } catch {
          // Not JSON — leave Content-Type unset; the server will decide
        }
      }
    }

    // Timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    fetchOptions.signal = controller.signal;

    try {
      const response = await fetch(url, fetchOptions);

      const responseHeaders = pickResponseHeaders(response.headers);
      const contentType = response.headers.get("content-type") ?? "";
      let responseBody = await response.text();

      // Pretty-print JSON responses
      if (
        contentType.includes("application/json") ||
        contentType.includes("+json")
      ) {
        try {
          const parsed = JSON.parse(responseBody);
          responseBody = JSON.stringify(parsed, null, 2);
        } catch {
          // Body isn't valid JSON despite content-type; keep as-is
        }
      }

      // Truncate if too long
      let truncated = false;
      if (responseBody.length > MAX_BODY_LENGTH) {
        responseBody =
          responseBody.slice(0, MAX_BODY_LENGTH) + "\n\n... [truncated]";
        truncated = true;
      }

      const content = formatResponse(
        response.status,
        response.statusText,
        responseHeaders,
        responseBody,
      );

      return {
        content,
        isError: !response.ok,
        metadata: {
          url,
          method,
          status: response.status,
          contentType,
          truncated,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          content: `Request timed out after ${timeout}ms for ${url}`,
          isError: true,
          metadata: { url, method, timedOut: true },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `HTTP request failed for ${url}: ${message}`,
        isError: true,
        metadata: { url, method },
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

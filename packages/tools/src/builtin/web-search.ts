import type { Tool, ToolResult } from "@agentclaw/types";

const DEFAULT_MAX_RESULTS = 5;
const SEARCH_TIMEOUT = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Parse Bing HTML search results */
function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Bing results are in <li class="b_algo"> blocks
  // Each contains: <h2><a href="URL">TITLE</a></h2>
  // and a caption/snippet area
  const blockRegex =
    /<li class="b_algo">([\s\S]*?)(?=<li class="b_algo">|<\/ol>|$)/gi;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break;

    const block = blockMatch[1];

    // Extract URL and title from <h2><a href="...">title</a></h2>
    const linkMatch = block.match(
      /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();

    // Extract snippet from <p> or <div class="b_caption">
    let snippet = "";
    const snippetMatch = block.match(
      /<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i,
    );
    if (snippetMatch) {
      snippet = snippetMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();
    }

    if (title && url && !url.includes("bing.com")) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/** Format search results into readable text */
function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No results found for: ${query}`;
  }

  const lines = [`Search results for: ${query}`, ""];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web using Bing. Returns search results with titles, URLs, and snippets.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results (default: 5)",
      },
    },
    required: ["query"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const maxResults = (input.max_results as number) ?? DEFAULT_MAX_RESULTS;

    if (!query.trim()) {
      return {
        content: "Search query cannot be empty",
        isError: true,
      };
    }

    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&mkt=zh-CN`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      if (!response.ok) {
        return {
          content: `Search request failed: HTTP ${response.status} ${response.statusText}`,
          isError: true,
          metadata: { status: response.status, query },
        };
      }

      const html = await response.text();
      const results = parseResults(html, maxResults);
      const content = formatResults(results, query);

      return {
        content,
        isError: false,
        metadata: {
          query,
          resultCount: results.length,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          content: `Search timed out after ${SEARCH_TIMEOUT}ms for query: ${query}`,
          isError: true,
          metadata: { query, timedOut: true },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Search failed: ${message}`,
        isError: true,
        metadata: { query },
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

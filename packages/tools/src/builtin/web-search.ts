import type { Tool, ToolResult } from "@agentclaw/types";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8888";
const SERPER_URL = "https://google.serper.dev/search";
const SEARCH_TIMEOUT = 10_000;

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** Format search results into numbered lines */
function formatResults(results: SearchResult[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push("");
  }
  return lines;
}

/** Search via self-hosted SearXNG instance */
async function searchSearXNG(
  query: string,
  maxResults: number,
): Promise<string | null> {
  const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const lines: string[] = [];

    // Direct answers
    for (const answer of data.answers ?? []) {
      lines.push(`Direct answer: ${answer}`, "");
    }

    // Infoboxes
    for (const ib of data.infoboxes ?? []) {
      const content = ib.content;
      if (content) {
        lines.push(`${ib.infobox ?? ""}: ${content.slice(0, 300)}`, "");
      }
    }

    // Results
    const results: SearchResult[] = (data.results ?? [])
      .slice(0, maxResults)
      .map((r: Record<string, string>) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content,
      }));

    if (results.length === 0 && lines.length === 0) return null;

    lines.push(...formatResults(results));

    return lines.join("\n").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Search via Google Serper API (paid fallback) */
async function searchSerper(
  query: string,
  maxResults: number,
): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return "Error: No search backend available. Set SEARXNG_URL or SERPER_API_KEY.";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: Math.min(maxResults, 10),
        hl: "zh-cn",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      return `Search API error (${res.status}): ${body}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const lines: string[] = [];

    // Answer box
    const answerBox = data.answerBox;
    const answer = answerBox?.answer || answerBox?.snippet;
    if (answer) lines.push(`Direct answer: ${answer}`, "");

    // Knowledge graph
    const kg = data.knowledgeGraph;
    if (kg?.description) {
      lines.push(`${kg.title ?? ""}: ${kg.description}`, "");
    }

    // Organic results
    const items = data.organic ?? [];
    if (items.length === 0 && lines.length === 0) {
      return `No results found for: ${query}`;
    }

    const results: SearchResult[] = items.map(
      (item: Record<string, string>) => ({
        title: item.title ?? "",
        url: item.link ?? "",
        snippet: item.snippet,
      }),
    );
    lines.push(...formatResults(results));

    return lines.join("\n").trim();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return `Search timed out for: ${query}`;
    }
    const message = err instanceof Error ? err.message : String(err);
    return `Search failed: ${message}`;
  } finally {
    clearTimeout(timer);
  }
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web via SearXNG/Serper. Returns titles, URLs and snippets.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      max_results: { type: "number", default: 5 },
    },
    required: ["query"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const maxResults = (input.max_results as number) ?? 5;

    if (!query.trim()) {
      return { content: "Error: empty search query", isError: true };
    }

    // SearXNG first, Serper fallback
    const searxResult = await searchSearXNG(query, maxResults);
    const content = searxResult ?? (await searchSerper(query, maxResults));

    return {
      content,
      isError: content.startsWith("Error:"),
      metadata: { query, maxResults },
    };
  },
};

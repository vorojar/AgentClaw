import type { Tool, ToolResult } from "@agentclaw/types";

const DEFAULT_SERPER_URL = "https://google.serper.dev/search";
const DEFAULT_QUERIT_URL = "https://api.querit.ai/v1/search";
const SEARCH_TIMEOUT = 10_000;
const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 5;

/** Search engine config — injected at startup via setSearchEngines() */
interface SearchEngine {
  id: string;
  type: "searxng" | "serper" | "querit" | "custom";
  enabled: boolean;
  url?: string;
  apiKey?: string;
}

/** Runtime search engine list — set by gateway bootstrap */
let searchEngines: SearchEngine[] = [];

/** Called by gateway to inject search engine config */
export function setSearchEngines(engines: SearchEngine[]): void {
  searchEngines = engines;
}

function readMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(HARD_MAX_RESULTS, Math.floor(value)));
}

function isZeroResultContent(content: string): boolean {
  return /^0 results for /i.test(content.trim());
}

function buildQueryVariants(query: string): string[] {
  const variants = [query.trim()];
  const withoutSite = query
    .replace(/\bsite:([^\s]+)/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutSite && withoutSite !== variants[0]) {
    variants.push(withoutSite);
  }

  const withoutExactDate = withoutSite
    .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g, "")
    .replace(
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (withoutExactDate && !variants.includes(withoutExactDate)) {
    variants.push(withoutExactDate);
  }

  return variants;
}

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** Format search results in TOON (Token-Optimized Object Notation) format */
function formatResults(results: SearchResult[]): string[] {
  const lines: string[] = [];
  lines.push(`results[${results.length}]{title,url}:`);
  for (const r of results) {
    const snippet = r.snippet ? ` — ${r.snippet.slice(0, 120)}` : "";
    lines.push(`  ${r.title}${snippet}`);
    lines.push(`  ${r.url}`);
  }
  lines.push("");
  lines.push(
    "hint: if the direct answer/snippets contain enough facts, answer from them with source links; use web_fetch(url) only when snippets are insufficient.",
  );
  return lines;
}

/** Search via self-hosted SearXNG instance */
async function searchSearXNG(
  baseUrl: string,
  query: string,
  maxResults: number,
): Promise<string | null> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
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

    if (results.length === 0 && lines.length === 0)
      return `0 results for "${query}". Try different keywords or a broader query.`;

    lines.push(...formatResults(results));

    return lines.join("\n").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Search via Google Serper API */
async function searchSerper(
  url: string,
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
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

    if (!res.ok) return null;

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
    if (items.length === 0 && lines.length === 0)
      return `0 results for "${query}". Try different keywords or a broader query.`;

    const results: SearchResult[] = items.map(
      (item: Record<string, string>) => ({
        title: item.title ?? "",
        url: item.link ?? "",
        snippet: item.snippet,
      }),
    );
    lines.push(...formatResults(results));

    return lines.join("\n").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Search via Querit API */
async function searchQuerit(
  url: string,
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        count: Math.min(maxResults, 10),
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const items = data.results?.result ?? data.results ?? data.organic ?? [];
    if (items.length === 0)
      return `0 results for "${query}". Try different keywords or a broader query.`;

    const results: SearchResult[] = items.map(
      (item: Record<string, string>) => ({
        title: item.title ?? "",
        url: item.url ?? item.link ?? "",
        snippet: item.snippet ?? item.content,
      }),
    );

    return formatResults(results).join("\n").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Execute a single search engine */
async function executeEngine(
  engine: SearchEngine,
  query: string,
  maxResults: number,
): Promise<string | null> {
  switch (engine.type) {
    case "searxng":
      return searchSearXNG(
        engine.url || "http://localhost:8888",
        query,
        maxResults,
      );
    case "serper":
      return engine.apiKey
        ? searchSerper(
            engine.url || DEFAULT_SERPER_URL,
            engine.apiKey,
            query,
            maxResults,
          )
        : null;
    case "querit":
      return engine.apiKey
        ? searchQuerit(
            engine.url || DEFAULT_QUERIT_URL,
            engine.apiKey,
            query,
            maxResults,
          )
        : null;
    case "custom":
      // Custom engines use SearXNG-compatible JSON API (GET ?q=...&format=json)
      return engine.url ? searchSearXNG(engine.url, query, maxResults) : null;
    default:
      return null;
  }
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web via SearXNG/Serper. Returns titles, URLs and snippets.",
  category: "builtin",
  pure: true,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      max_results: { type: "number", default: DEFAULT_MAX_RESULTS },
    },
    required: ["query"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const maxResults = readMaxResults(input.max_results);

    if (!query.trim()) {
      return { content: "Error: empty search query", isError: true };
    }

    const queryVariants = buildQueryVariants(query);
    const attemptedQueries: string[] = [];
    const zeroResultMessages: string[] = [];

    // Try enabled engines in order (priority = array order)
    const enabled = searchEngines.filter((e) => e.enabled);
    for (const queryVariant of queryVariants) {
      for (const engine of enabled) {
        if (!attemptedQueries.includes(queryVariant)) {
          attemptedQueries.push(queryVariant);
        }
        const result = await executeEngine(engine, queryVariant, maxResults);
        if (!result) continue;
        if (isZeroResultContent(result)) {
          zeroResultMessages.push(result);
          continue;
        }
        return {
          content: result,
          isError: false,
          metadata: {
            query,
            effectiveQuery: queryVariant,
            attemptedQueries,
            maxResults,
            engine: engine.id,
          },
        };
      }
    }

    if (enabled.length === 0) {
      return {
        content:
          "Error: No search backend available. Configure search engines in Settings.",
        isError: true,
      };
    }

    return {
      content:
        zeroResultMessages.at(-1) ??
        `0 results for "${query}" across ${enabled.length} search engine(s). Try different keywords.`,
      isError: true,
      metadata: { query, attemptedQueries, maxResults, zeroResults: true },
    };
  },
};

import type { Tool, ToolResult } from "@agentclaw/types";

const DEFAULT_MAX_RESULTS = 5;

interface SerperResult {
  title: string;
  link: string;
  snippet?: string;
}

interface SerperResponse {
  organic?: SerperResult[];
  answerBox?: { answer?: string; snippet?: string; title?: string };
  knowledgeGraph?: { title?: string; description?: string };
}

function formatResults(data: SerperResponse, query: string): string {
  const lines: string[] = [];

  // Answer box (direct answer)
  if (data.answerBox?.answer) {
    lines.push(`Direct answer: ${data.answerBox.answer}`, "");
  } else if (data.answerBox?.snippet) {
    lines.push(`Direct answer: ${data.answerBox.snippet}`, "");
  }

  // Knowledge graph
  if (data.knowledgeGraph?.description) {
    lines.push(
      `${data.knowledgeGraph.title ?? ""}: ${data.knowledgeGraph.description}`,
      "",
    );
  }

  // Organic results
  const items = data.organic ?? [];
  if (items.length === 0 && lines.length === 0) {
    return `No results found for: ${query}`;
  }

  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.link}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web via Google.",
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
    const maxResults = Math.min(
      (input.max_results as number) ?? DEFAULT_MAX_RESULTS,
      10,
    );

    if (!query.trim()) {
      return { content: "Search query cannot be empty", isError: true };
    }

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      return {
        content:
          "Web search not configured. Set SERPER_API_KEY environment variable.",
        isError: true,
      };
    }

    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          num: maxResults,
          hl: "zh-cn",
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return {
          content: `Search API error (${res.status}): ${body}`,
          isError: true,
          metadata: { query, status: res.status },
        };
      }

      const data = (await res.json()) as SerperResponse;
      const content = formatResults(data, query);

      return {
        content,
        metadata: { query, resultCount: data.organic?.length ?? 0 },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Search failed: ${message}`,
        isError: true,
        metadata: { query },
      };
    }
  },
};

import type { Tool, ToolExecutionContext, ToolResult } from "@agentclaw/types";

type SessionSearchInput = {
  query?: string;
  sessionId?: string;
  aroundTurnId?: string;
  limit?: number;
  window?: number;
};

type SessionSearchMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  anchor?: boolean;
};

function stringInput(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function numberInput(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function truncate(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max
    ? `${normalized.slice(0, Math.max(0, max - 1))}…`
    : normalized;
}

function formatMessages(messages: SessionSearchMessage[]): string {
  return messages
    .map((message) => {
      const marker = message.anchor ? " anchor" : "";
      return `  - ${message.id}${marker} ${message.role}: ${truncate(message.content)}`;
    })
    .join("\n");
}

function normalizeInput(input: Record<string, unknown>): SessionSearchInput {
  const query = stringInput(input.query);
  const sessionId =
    stringInput(input.session_id) ?? stringInput(input.sessionId);
  const aroundTurnId =
    stringInput(input.around_turn_id) ?? stringInput(input.aroundTurnId);
  const limit =
    input.limit === undefined ? undefined : numberInput(input.limit, 5);
  const window =
    input.window === undefined ? undefined : numberInput(input.window, 5);
  return { query, sessionId, aroundTurnId, limit, window };
}

export const sessionSearchTool: Tool = {
  name: "session_search",
  description:
    "Search or read prior conversation sessions. Use when the user references previous work, asks to continue an old task, or needs context from another session. Supports discovery with query, full/session read with session_id, and scrolling with session_id + around_turn_id.",
  category: "builtin",
  pure: true,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Discovery query for past sessions.",
      },
      session_id: {
        type: "string",
        description: "Session ID to read or scroll.",
      },
      around_turn_id: {
        type: "string",
        description:
          "Turn ID to center a scroll window around. Requires session_id.",
      },
      limit: {
        type: "number",
        description: "Max sessions to return for discovery. Default 5.",
      },
      window: {
        type: "number",
        description:
          "Number of messages before/after around_turn_id for scroll. Default 5.",
      },
    },
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!context?.sessionSearch) {
      return {
        content: "Session search is not available in this context.",
        isError: true,
      };
    }

    const normalized = normalizeInput(input);
    if (!normalized.query && !normalized.sessionId) {
      return {
        content:
          "Provide either query for discovery or session_id to read/scroll a session.",
        isError: true,
      };
    }

    const result = await context.sessionSearch(normalized);

    if (result.mode === "discovery") {
      const results = result.results ?? [];
      if (results.length === 0) {
        return { content: "No matching sessions found.", isError: false };
      }
      const lines = results.map((item, index) => {
        const chunks = [
          `[${index + 1}] ${item.title ?? "(untitled)"} session=${item.sessionId} conversation=${item.conversationId}`,
          `updated=${item.updatedAt}`,
        ];
        if (item.snippet) chunks.push(`snippet=${truncate(item.snippet)}`);
        if (item.matchTurnId) chunks.push(`match_turn_id=${item.matchTurnId}`);
        if (item.messagesBefore !== undefined) {
          chunks.push(`messages_before=${item.messagesBefore}`);
        }
        if (item.messagesAfter !== undefined) {
          chunks.push(`messages_after=${item.messagesAfter}`);
        }
        if (item.bookendStart.length > 0) {
          chunks.push(`bookend_start:\n${formatMessages(item.bookendStart)}`);
        }
        if (item.messages.length > 0) {
          chunks.push(`messages:\n${formatMessages(item.messages)}`);
        }
        if (item.bookendEnd.length > 0) {
          chunks.push(`bookend_end:\n${formatMessages(item.bookendEnd)}`);
        }
        return chunks.join("\n");
      });
      return {
        content: `sessions[${results.length}]\n${lines.join("\n\n")}`,
        isError: false,
      };
    }

    if (!result.session) {
      return { content: "Session not found.", isError: true };
    }

    const session = result.session;
    const lines = [
      `${result.mode} session=${session.sessionId} conversation=${session.conversationId}`,
      `title=${session.title ?? "(untitled)"}`,
      `updated=${session.updatedAt}`,
    ];
    if (session.messagesBefore !== undefined) {
      lines.push(`messages_before=${session.messagesBefore}`);
    }
    if (session.messagesAfter !== undefined) {
      lines.push(`messages_after=${session.messagesAfter}`);
    }
    lines.push(`messages:\n${formatMessages(session.messages)}`);

    return { content: lines.join("\n"), isError: false };
  },
};

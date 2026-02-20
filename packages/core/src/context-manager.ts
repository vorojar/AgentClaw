import type {
  ContextManager,
  Message,
  ContentBlock,
  MemoryStore,
  ConversationTurn,
  SkillRegistry,
} from "@agentclaw/types";

const DEFAULT_SYSTEM_PROMPT = `You are AgentClaw, a powerful AI assistant. You MUST use tools to help the user. Do NOT say you cannot do something — use the appropriate tool instead.

IMPORTANT RULES:
- When the user asks to search, use the "web_search" tool.
- When the user asks to read a file, use the "file_read" tool.
- When the user asks to write a file, use the "file_write" tool.
- When the user asks to run a command, use the "shell" tool.
- When the user asks to fetch a URL, use the "web_fetch" tool.
- Always respond in the same language the user uses.
- Think step by step before acting.`;

export class SimpleContextManager implements ContextManager {
  private systemPrompt: string;
  private memoryStore: MemoryStore;
  private skillRegistry?: SkillRegistry;
  private maxHistoryTurns: number;

  constructor(options: {
    systemPrompt?: string;
    memoryStore: MemoryStore;
    skillRegistry?: SkillRegistry;
    maxHistoryTurns?: number;
  }) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.memoryStore = options.memoryStore;
    this.skillRegistry = options.skillRegistry;
    this.maxHistoryTurns = options.maxHistoryTurns ?? 50;
  }

  async buildContext(
    conversationId: string,
    currentInput: string | ContentBlock[],
  ): Promise<{ systemPrompt: string; messages: Message[] }> {
    // Get conversation history
    const turns = await this.memoryStore.getHistory(
      conversationId,
      this.maxHistoryTurns,
    );

    // Convert turns to Messages, rebuilding tool_use and tool_result content blocks
    const messages: Message[] = turns.map((turn) => this.turnToMessage(turn));

    let finalPrompt = this.systemPrompt;

    // Extract text from input for memory search query
    const searchQuery =
      typeof currentInput === "string"
        ? currentInput
        : currentInput
            .filter(
              (b): b is { type: "text"; text: string } => b.type === "text",
            )
            .map((b) => b.text)
            .join(" ");

    // Recall relevant long-term memories and inject into system prompt
    try {
      const memories = await this.memoryStore.search({
        query: searchQuery,
        limit: 10,
      });
      if (memories.length > 0) {
        const memoryLines = memories
          .map((m) => `- [${m.entry.type}] ${m.entry.content}`)
          .join("\n");
        finalPrompt += `\n\nYour long-term memory (things you know about the user and previous interactions):\n${memoryLines}\n\nUse this information naturally. Do NOT create files to remember things — you already have a built-in memory system.`;
      }
    } catch {
      // Memory search failed — continue without memories
    }

    // Match skills against user input
    if (this.skillRegistry) {
      try {
        const matches = await this.skillRegistry.match(searchQuery);
        // Take top match with confidence > 0.3
        const topMatch = matches.find((m) => m.confidence > 0.3);
        if (topMatch) {
          finalPrompt += `\n\n## Active Skill: ${topMatch.skill.name}\n${topMatch.skill.instructions}`;
        }
      } catch {
        // Skill matching failed — continue without skills
      }
    }

    return {
      systemPrompt: finalPrompt,
      messages,
    };
  }

  /** Rebuild a full Message (with ContentBlock[]) from a stored ConversationTurn */
  private turnToMessage(turn: ConversationTurn): Message {
    // Assistant turn with tool calls — reconstruct ContentBlock[] including tool_use blocks
    if (turn.role === "assistant" && turn.toolCalls) {
      const blocks: ContentBlock[] = [];
      if (turn.content) {
        blocks.push({ type: "text", text: turn.content });
      }
      try {
        const toolCalls = JSON.parse(turn.toolCalls) as Array<{
          id: string;
          name: string;
          input: Record<string, unknown>;
        }>;
        for (const tc of toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      } catch {
        // If toolCalls JSON is corrupted, fall back to text-only
      }
      return {
        id: turn.id,
        role: "assistant",
        content: blocks,
        createdAt: turn.createdAt,
        model: turn.model,
      };
    }

    // Tool result turn — reconstruct ContentBlock[] with tool_result blocks
    if (turn.role === "tool") {
      try {
        const blocks = JSON.parse(turn.content) as ContentBlock[];
        return {
          id: turn.id,
          role: "tool",
          content: blocks,
          createdAt: turn.createdAt,
        };
      } catch {
        // Fallback: plain string
      }
    }

    // 用户消息可能包含多模态内容（ContentBlock[] 序列化为 JSON），尝试解析
    if (turn.role === "user") {
      try {
        const parsed = JSON.parse(turn.content);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
          return {
            id: turn.id,
            role: turn.role,
            content: parsed as ContentBlock[],
            createdAt: turn.createdAt,
            model: turn.model,
          };
        }
      } catch {
        // 不是 JSON，按纯文本处理
      }
    }

    // User / system / plain assistant — plain text
    return {
      id: turn.id,
      role: turn.role,
      content: turn.content,
      createdAt: turn.createdAt,
      model: turn.model,
    };
  }
}

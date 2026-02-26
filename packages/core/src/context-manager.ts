import type {
  ContextManager,
  Message,
  ContentBlock,
  MemoryStore,
  ConversationTurn,
  SkillRegistry,
  LLMProvider,
} from "@agentclaw/types";

const DEFAULT_SYSTEM_PROMPT = `You are AgentClaw, a powerful AI assistant.

- For casual conversation, greetings, or simple questions you already know the answer to: reply directly in plain text. Do NOT call any tools.
- For tasks that genuinely require action (file operations, web search, running commands, etc.): use the appropriate tool. Do NOT say you cannot do something — use a tool instead.
- Always respond in the same language the user uses.
- Think step by step before acting.`;

export class SimpleContextManager implements ContextManager {
  private systemPrompt: string;
  private memoryStore: MemoryStore;
  private skillRegistry?: SkillRegistry;
  private provider?: LLMProvider;
  private maxHistoryTurns: number;
  private compressAfter: number;
  private summaryCache = new Map<string, string>();

  /**
   * KV-Cache optimization: cache dynamic prefix (memories + skills) per conversation.
   * Reused on agent loop iterations 2+ to keep the prefix stable.
   */
  private dynamicPrefixCache = new Map<
    string,
    {
      messages: Message[];
      skillMatch?: { name: string; confidence: number };
    }
  >();

  constructor(options: {
    systemPrompt?: string;
    memoryStore: MemoryStore;
    skillRegistry?: SkillRegistry;
    provider?: LLMProvider;
    maxHistoryTurns?: number;
    compressAfter?: number;
  }) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.memoryStore = options.memoryStore;
    this.skillRegistry = options.skillRegistry;
    this.provider = options.provider;
    this.maxHistoryTurns = options.maxHistoryTurns ?? 50;
    this.compressAfter = options.compressAfter ?? 20;
  }

  async buildContext(
    conversationId: string,
    currentInput: string | ContentBlock[],
    options?: {
      preSelectedSkillName?: string;
      reuseContext?: boolean;
    },
  ): Promise<{
    systemPrompt: string;
    messages: Message[];
    skillMatch?: { name: string; confidence: number };
  }> {
    // ── 1. History ──
    const turns = await this.memoryStore.getHistory(
      conversationId,
      this.maxHistoryTurns,
    );

    let historyMessages: Message[];
    if (turns.length > this.compressAfter) {
      const oldTurns = turns.slice(0, turns.length - this.compressAfter);
      const recentTurns = turns.slice(turns.length - this.compressAfter);
      const summary = await this.compressTurns(conversationId, oldTurns);
      historyMessages = [
        {
          id: "summary",
          role: "user",
          content: summary,
          createdAt: oldTurns[0].createdAt,
        },
        {
          id: "summary-ack",
          role: "assistant",
          content: "Understood, I have the conversation context.",
          createdAt: oldTurns[0].createdAt,
        },
        ...recentTurns.map((turn) => this.turnToMessage(turn)),
      ];
    } else {
      historyMessages = turns.map((turn) => this.turnToMessage(turn));
    }

    // ── 2. System prompt: ALWAYS static (never mutated) ──
    // This is the key to KV-cache optimization.
    // Memories, skills, and active skill instructions go into messages instead.

    // ── 3. Dynamic prefix (memories + skills → user/assistant message pair) ──
    let dynamicPrefix: Message[];
    let skillMatch: { name: string; confidence: number } | undefined;

    if (options?.reuseContext && this.dynamicPrefixCache.has(conversationId)) {
      // Agent loop iteration 2+: reuse cached prefix (skip memory search)
      const cached = this.dynamicPrefixCache.get(conversationId)!;
      dynamicPrefix = cached.messages;
      skillMatch = cached.skillMatch;
    } else {
      // First iteration: build dynamic prefix
      const result = await this.buildDynamicPrefix(currentInput, options);
      dynamicPrefix = result.messages;
      skillMatch = result.skillMatch;
      // Cache for subsequent iterations
      this.dynamicPrefixCache.set(conversationId, {
        messages: dynamicPrefix,
        skillMatch,
      });
    }

    // ── 4. Assemble: [dynamic prefix] + [history] ──
    const messages = [...dynamicPrefix, ...historyMessages];

    return {
      systemPrompt: this.systemPrompt,
      messages,
      skillMatch,
    };
  }

  /**
   * Build dynamic context prefix: memories + skill catalog + active skill.
   * Returns a user/assistant message pair to prepend to messages.
   */
  private async buildDynamicPrefix(
    currentInput: string | ContentBlock[],
    options?: { preSelectedSkillName?: string },
  ): Promise<{
    messages: Message[];
    skillMatch?: { name: string; confidence: number };
  }> {
    const parts: string[] = [];
    let skillMatch: { name: string; confidence: number } | undefined;

    // ── Memories ──
    const searchQuery =
      typeof currentInput === "string"
        ? currentInput
        : currentInput
            .filter(
              (b): b is { type: "text"; text: string } => b.type === "text",
            )
            .map((b) => b.text)
            .join(" ");

    try {
      const memories = await this.memoryStore.search({
        query: searchQuery,
        limit: 5,
      });
      if (memories.length > 0) {
        const lines: string[] = [];
        let totalChars = 0;
        for (const m of memories) {
          const line = `- [${m.entry.type}] ${m.entry.content}`;
          if (totalChars + line.length > 2000) break;
          lines.push(line);
          totalChars += line.length;
        }
        if (lines.length > 0) {
          parts.push(
            `Long-term memory:\n${lines.join("\n")}\nUse this information naturally. Do NOT create files to remember things.`,
          );
        }
      }
    } catch {
      // Memory search failed — continue without memories
    }

    // ── Skill catalog ──
    if (this.skillRegistry) {
      try {
        const preSkillName = options?.preSelectedSkillName;
        if (preSkillName) {
          const skill = this.skillRegistry.get(preSkillName);
          if (skill) {
            parts.push(`[Active Skill: ${skill.name}]\n${skill.instructions}`);
            skillMatch = { name: skill.name, confidence: 1.0 };
          }
        }

        const allSkills = this.skillRegistry.list().filter((s) => s.enabled);
        if (allSkills.length > 0) {
          const catalog = allSkills
            .map((s) => {
              const d = s.description;
              const cn = d.includes("|")
                ? d.split("|")[0].trim()
                : d.slice(0, 15);
              return `${s.name}(${cn})`;
            })
            .join(", ");
          parts.push(`Skills (call use_skill(name) to activate): ${catalog}`);
        }
      } catch {
        // Skill catalog failed — continue without it
      }
    }

    // No dynamic context needed
    if (parts.length === 0) {
      return { messages: [], skillMatch };
    }

    // Build user/assistant pair (maintains message alternation for Claude)
    const contextText = `[Context]\n${parts.join("\n\n")}`;
    const now = new Date();
    const messages: Message[] = [
      {
        id: "ctx",
        role: "user",
        content: contextText,
        createdAt: now,
      },
      {
        id: "ctx-ack",
        role: "assistant",
        content: "OK.",
        createdAt: now,
      },
    ];

    return { messages, skillMatch };
  }

  private async compressTurns(
    conversationId: string,
    turns: ConversationTurn[],
  ): Promise<string> {
    const cacheKey = `${conversationId}:${turns.length}`;
    const cached = this.summaryCache.get(cacheKey);
    if (cached) return cached;

    // Build raw transcript for LLM summarization
    const transcript = this.buildTranscript(turns);

    // Try LLM summarization
    if (this.provider) {
      try {
        const resp = await this.provider.chat({
          messages: [
            {
              id: "sum",
              role: "user",
              content: transcript,
              createdAt: new Date(),
            },
          ],
          systemPrompt:
            "Summarize this conversation in 3-5 bullet points. Keep key facts, decisions, and user preferences. Reply in the same language the user used. Be concise (under 500 chars).",
          maxTokens: 300,
        });
        const text =
          typeof resp.message.content === "string" ? resp.message.content : "";
        const summary = `[Earlier conversation summary]\n${text}`;
        this.summaryCache.set(cacheKey, summary);
        return summary;
      } catch {
        // LLM failed, fall through to truncation
      }
    }

    // Fallback: simple truncation
    const summary = `[Earlier conversation summary]\n${transcript}`;
    const result =
      summary.length > 2000 ? summary.slice(0, 2000) + "\n..." : summary;
    this.summaryCache.set(cacheKey, result);
    return result;
  }

  private buildTranscript(turns: ConversationTurn[]): string {
    const lines: string[] = [];
    for (const turn of turns) {
      if (turn.role === "user") {
        const text =
          turn.content.length > 200
            ? turn.content.slice(0, 200) + "..."
            : turn.content;
        lines.push(`User: ${text}`);
      } else if (turn.role === "assistant") {
        const text =
          turn.content.length > 200
            ? turn.content.slice(0, 200) + "..."
            : turn.content;
        lines.push(`Assistant: ${text}`);
      }
    }
    const transcript = lines.join("\n");
    return transcript.length > 4000
      ? transcript.slice(0, 4000) + "\n..."
      : transcript;
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

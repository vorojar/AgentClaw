import { readFileSync, existsSync } from "node:fs";
import type {
  ContextManager,
  Message,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
  MemoryStore,
  ConversationTurn,
  SkillRegistry,
  LLMProvider,
} from "@agentclaw/types";

/** Remove lone surrogates that break JSON serialization */
function sanitizeString(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

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

  /** Cached skill catalog string — built once, reused across all conversations */
  private skillCatalogCache?: string;

  /**
   * Frozen snapshot of dynamic context (memories + skills) per conversation.
   * Built once on the first turn, reused for the entire session.
   * Memory writes during session persist to DB but don't alter the system prompt,
   * keeping it stable for prefix cache efficiency (Anthropic prompt caching).
   */
  private dynamicContextCache = new Map<
    string,
    {
      suffix: string;
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
      // Find the compress boundary, avoiding splitting tool_call/result pairs
      let splitIdx = turns.length - this.compressAfter;
      // If the split point lands on a "tool" turn, push it forward past tool results
      while (splitIdx < turns.length && turns[splitIdx].role === "tool") {
        splitIdx++;
      }
      // Safety: don't compress everything
      if (splitIdx >= turns.length - 2)
        splitIdx = turns.length - this.compressAfter;

      const oldTurns = turns.slice(0, splitIdx);
      const recentTurns = turns.slice(splitIdx);
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

    // ── 2. Dynamic context (memories + skills) → appended to system prompt ──
    let dynamicSuffix: string;
    let skillMatch: { name: string; confidence: number } | undefined;

    // Frozen snapshot: once built for a conversation, reuse for entire session.
    // Memory changes during session are persisted to DB but don't alter the
    // system prompt — this keeps the prompt stable for prefix cache efficiency.
    if (this.dynamicContextCache.has(conversationId)) {
      const cached = this.dynamicContextCache.get(conversationId)!;
      dynamicSuffix = cached.suffix;
      skillMatch = cached.skillMatch;
    } else {
      const result = await this.buildDynamicContext(currentInput, options);
      dynamicSuffix = result.suffix;
      skillMatch = result.skillMatch;
      this.dynamicContextCache.set(conversationId, {
        suffix: dynamicSuffix,
        skillMatch,
      });
      // Evict oldest entries if cache exceeds size limit
      if (this.dynamicContextCache.size > 200) {
        const firstKey = this.dynamicContextCache.keys().next().value;
        if (firstKey) this.dynamicContextCache.delete(firstKey);
      }
    }

    // ── 3. Truncate old tool results to save context ──
    // Keep the last 2 tool result messages intact; older ones get a compact
    // placeholder that preserves *which* tool was called (aids LLM reasoning).
    const TOOL_RESULT_KEEP_RECENT = 2;
    const TOOL_RESULT_MAX_CHARS = 500;
    let toolResultCount = 0;
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      if (historyMessages[i].role === "tool") toolResultCount++;
    }
    if (toolResultCount > TOOL_RESULT_KEEP_RECENT) {
      // Build tool_use_id → tool_name map from assistant messages
      const toolNameMap = new Map<string, string>();
      for (const msg of historyMessages) {
        if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
        for (const block of msg.content as ContentBlock[]) {
          if (block.type === "tool_use") {
            const tu = block as ToolUseContent;
            toolNameMap.set(tu.id, tu.name);
          }
        }
      }

      historyMessages = historyMessages.map((m) => ({ ...m }));
      let seen = 0;
      for (let i = historyMessages.length - 1; i >= 0; i--) {
        if (historyMessages[i].role !== "tool") continue;
        seen++;
        if (seen <= TOOL_RESULT_KEEP_RECENT) continue;
        const msg = historyMessages[i];
        if (
          typeof msg.content === "string" &&
          msg.content.length > TOOL_RESULT_MAX_CHARS
        ) {
          msg.content =
            msg.content.slice(0, TOOL_RESULT_MAX_CHARS) +
            `\n... [truncated, ${msg.content.length} chars total]`;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content as ContentBlock[]) {
            if (
              block.type === "tool_result" &&
              typeof block.content === "string" &&
              block.content.length > TOOL_RESULT_MAX_CHARS
            ) {
              const name = toolNameMap.get(
                (block as ToolResultContent).toolUseId,
              );
              block.content = name
                ? `[Previous: used ${name}]`
                : `[Previous tool result truncated, ${block.content.length} chars]`;
            }
          }
        }
      }
    }

    // ── 3.5. Fix orphaned tool_call/tool_result pairs after compression ──
    historyMessages = this.sanitizeToolPairs(historyMessages);

    // ── 4. Assemble ──
    const finalPrompt = dynamicSuffix
      ? `${this.systemPrompt}\n\n${dynamicSuffix}`
      : this.systemPrompt;

    return {
      systemPrompt: finalPrompt,
      messages: historyMessages,
      skillMatch,
    };
  }

  /**
   * Build dynamic context: memories + skill catalog + active skill.
   * Returns a string to append to the system prompt.
   */
  private async buildDynamicContext(
    currentInput: string | ContentBlock[],
    options?: { preSelectedSkillName?: string },
  ): Promise<{
    suffix: string;
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
            `你的长期记忆：\n${lines.join("\n")}\n\n自然地使用这些信息。不要创建文件来记忆——你已有内置记忆系统。`,
          );
        }
      }
    } catch {
      // Memory search failed — continue without memories
    }

    // ── Skill catalog (cached globally — skill list doesn't change at runtime) ──
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

        if (this.skillCatalogCache === undefined) {
          const allSkills = this.skillRegistry.list().filter((s) => s.enabled);
          if (allSkills.length > 0) {
            const catalog = allSkills
              .map((s) =>
                s.description ? `${s.name}: ${s.description}` : s.name,
              )
              .join("\n- ");
            this.skillCatalogCache = `Skills (call use_skill(name) to activate):\n- ${catalog}`;
          } else {
            this.skillCatalogCache = "";
          }
        }
        if (this.skillCatalogCache) {
          parts.push(this.skillCatalogCache);
        }
      } catch {
        // Skill catalog failed — continue without it
      }
    }

    return {
      suffix: parts.join("\n\n"),
      skillMatch,
    };
  }

  /** Clear cached context for a conversation (call on session close) */
  clearConversationCache(conversationId: string): void {
    this.dynamicContextCache.delete(conversationId);
    // Also clear related summary entries (keyed as "conversationId:turnId")
    const prefix = `${conversationId}:`;
    for (const key of this.summaryCache.keys()) {
      if (key.startsWith(prefix)) this.summaryCache.delete(key);
    }
  }

  /** Add to summary cache with LRU eviction */
  private cacheSummary(key: string, value: string): void {
    this.summaryCache.set(key, value);
    if (this.summaryCache.size > 100) {
      const firstKey = this.summaryCache.keys().next().value;
      if (firstKey) this.summaryCache.delete(firstKey);
    }
  }

  private async compressTurns(
    conversationId: string,
    turns: ConversationTurn[],
  ): Promise<string> {
    const cacheKey = `${conversationId}:${turns[turns.length - 1]?.id ?? turns.length}`;
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
        this.cacheSummary(cacheKey, summary);
        return summary;
      } catch {
        // LLM failed, fall through to truncation
      }
    }

    // Fallback: simple truncation
    const summary = `[Earlier conversation summary]\n${transcript}`;
    const result =
      summary.length > 2000 ? summary.slice(0, 2000) + "\n..." : summary;
    this.cacheSummary(cacheKey, result);
    return result;
  }

  private buildTranscript(turns: ConversationTurn[]): string {
    const lines: string[] = [];
    for (const turn of turns) {
      if (turn.role !== "user" && turn.role !== "assistant") continue;
      const label = turn.role === "user" ? "User" : "Assistant";
      const text =
        turn.content.length > 200
          ? turn.content.slice(0, 200) + "..."
          : turn.content;
      lines.push(`${label}: ${text}`);
    }
    const transcript = lines.join("\n");
    return transcript.length > 4000
      ? transcript.slice(0, 4000) + "\n..."
      : transcript;
  }

  /**
   * Strip `/files/hex` URLs from stored user text so LLM doesn't pick up wrong paths.
   * `[Uploaded: name](/files/hex.xlsx)` → `[name]`
   */
  private cleanFileUrls(text: string): string {
    return text.replace(/\[Uploaded:\s*([^\]]*)\]\(\/files\/[^)]+\)/g, "[$1]");
  }

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
        // Sanitize tool result content to remove lone surrogates from DB
        for (const b of blocks) {
          if ((b as ToolResultContent).type === "tool_result") {
            (b as ToolResultContent).content = sanitizeString(
              (b as ToolResultContent).content,
            );
          }
        }
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
          // 还原 image block：filePath → 从磁盘加载 base64 data
          // 清理历史中的 /files/ URL，防止 LLM 拾取错误路径
          const cleaned = (
            parsed as (
              | ContentBlock
              | {
                  type: "image";
                  filePath: string;
                  mediaType?: string;
                  filename?: string;
                }
            )[]
          ).map((block) => {
            if (block.type === "text") {
              return { ...block, text: this.cleanFileUrls(block.text) };
            }
            if (
              block.type === "image" &&
              "filePath" in block &&
              block.filePath
            ) {
              // 从磁盘加载 base64，还原为完整 image ContentBlock
              try {
                if (existsSync(block.filePath)) {
                  const buf = readFileSync(block.filePath);
                  return {
                    type: "image" as const,
                    data: buf.toString("base64"),
                    mediaType: block.mediaType ?? "image/jpeg",
                  };
                }
              } catch {
                /* file not found, skip image */
              }
              // 文件不存在，跳过这个 image block
              return {
                type: "text" as const,
                text: `[图片文件已过期: ${block.filename || block.filePath}]`,
              };
            }
            return block;
          });
          return {
            id: turn.id,
            role: turn.role,
            content: cleaned as ContentBlock[],
            createdAt: turn.createdAt,
            model: turn.model,
          };
        }
      } catch {
        // 不是 JSON，按纯文本处理
      }
    }

    // User / system / plain assistant — plain text
    const content =
      turn.role === "user" ? this.cleanFileUrls(turn.content) : turn.content;
    return {
      id: turn.id,
      role: turn.role,
      content,
      createdAt: turn.createdAt,
      model: turn.model,
    };
  }

  /**
   * Fix orphaned tool_call / tool_result pairs after compression.
   *
   * Two failure modes:
   * 1. A tool result references a tool_call_id whose assistant tool_call was removed
   *    → remove the orphaned tool result
   * 2. An assistant message has tool_calls whose results were dropped
   *    → insert stub tool results so the API doesn't reject
   */
  private sanitizeToolPairs(messages: Message[]): Message[] {
    // Collect all tool_call IDs from assistant messages
    const survivingCallIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content as ContentBlock[]) {
          if (block.type === "tool_use" && block.id) {
            survivingCallIds.add(block.id);
          }
        }
      }
    }

    // Collect all tool_result IDs from tool messages
    const resultCallIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        for (const block of msg.content as ContentBlock[]) {
          if (
            (block as ToolResultContent).type === "tool_result" &&
            (block as ToolResultContent).toolUseId
          ) {
            resultCallIds.add((block as ToolResultContent).toolUseId);
          }
        }
      }
    }

    // 1. Remove tool messages whose tool_call_id has no matching assistant tool_call
    let result = messages.filter((msg) => {
      if (msg.role !== "tool" || !Array.isArray(msg.content)) return true;
      const blocks = msg.content as ContentBlock[];
      const toolResults = blocks.filter(
        (b) => (b as ToolResultContent).type === "tool_result",
      );
      if (toolResults.length === 0) return true;
      // Keep only if at least one tool_result has a surviving call
      return toolResults.some((b) =>
        survivingCallIds.has((b as ToolResultContent).toolUseId),
      );
    });

    // 2. Insert stub results for assistant tool_calls whose results were dropped
    const missingResults = new Set<string>();
    for (const id of survivingCallIds) {
      if (!resultCallIds.has(id)) missingResults.add(id);
    }

    if (missingResults.size > 0) {
      const patched: Message[] = [];
      for (const msg of result) {
        patched.push(msg);
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          for (const block of msg.content as ContentBlock[]) {
            if (
              block.type === "tool_use" &&
              block.id &&
              missingResults.has(block.id)
            ) {
              patched.push({
                id: `stub-${block.id}`,
                role: "tool",
                content: [
                  {
                    type: "tool_result",
                    toolUseId: block.id,
                    content:
                      "[Result from earlier conversation — see context summary above]",
                  },
                ] as ContentBlock[],
                createdAt: msg.createdAt,
              });
            }
          }
        }
      }
      result = patched;
    }

    return result;
  }
}

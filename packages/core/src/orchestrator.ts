import type {
  Orchestrator,
  Session,
  Message,
  ContentBlock,
  AgentEvent,
  ToolExecutionContext,
  LLMProvider,
  MemoryStore,
  AgentConfig,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import type { SkillRegistryImpl } from "./skills/registry.js";
import { generateId } from "@agentclaw/providers";
import { SimpleAgentLoop } from "./agent-loop.js";
import { SimpleContextManager } from "./context-manager.js";
import { MemoryExtractor } from "./memory-extractor.js";
import { readdirSync, unlinkSync } from "fs";
import { join } from "path";

/** How many user turns between automatic memory extraction runs */
const EXTRACT_EVERY_N_TURNS = 3;

export class SimpleOrchestrator implements Orchestrator {
  private sessions = new Map<string, Session>();
  private turnCounters = new Map<string, number>();
  private activeLoops = new Map<string, SimpleAgentLoop>();
  private provider: LLMProvider;
  private visionProvider?: LLMProvider;
  private fastProvider?: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private memoryStore: MemoryStore;
  private memoryExtractor: MemoryExtractor;
  private agentConfig?: Partial<AgentConfig>;
  private systemPrompt?: string;
  private scheduler?: ToolExecutionContext["scheduler"];
  private planner?: ToolExecutionContext["planner"];
  private skillRegistry?: SkillRegistryImpl;
  private tmpDir?: string;

  constructor(options: {
    provider: LLMProvider;
    visionProvider?: LLMProvider;
    fastProvider?: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    memoryStore: MemoryStore;
    agentConfig?: Partial<AgentConfig>;
    systemPrompt?: string;
    scheduler?: ToolExecutionContext["scheduler"];
    planner?: ToolExecutionContext["planner"];
    skillRegistry?: SkillRegistryImpl;
    tmpDir?: string;
  }) {
    this.provider = options.provider;
    this.visionProvider = options.visionProvider;
    this.fastProvider = options.fastProvider;
    this.toolRegistry = options.toolRegistry;
    this.memoryStore = options.memoryStore;
    this.memoryExtractor = new MemoryExtractor({
      provider: options.provider,
      memoryStore: options.memoryStore,
    });
    this.agentConfig = options.agentConfig;
    this.systemPrompt = options.systemPrompt;
    this.scheduler = options.scheduler;
    this.planner = options.planner;
    this.skillRegistry = options.skillRegistry;
    this.tmpDir = options.tmpDir;
  }

  async createSession(): Promise<Session> {
    const session: Session = {
      id: generateId(),
      conversationId: generateId(),
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.sessions.set(session.id, session);
    await this.memoryStore.saveSession(session);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    // 先查内存缓存
    let session = this.sessions.get(sessionId);
    if (session) return session;
    const stored = await this.memoryStore.getSessionById(sessionId);
    if (stored) {
      session = {
        id: stored.id,
        conversationId: stored.conversationId,
        createdAt: stored.createdAt,
        lastActiveAt: stored.lastActiveAt,
        title: stored.title,
        metadata: stored.metadata,
      };
      this.sessions.set(sessionId, session);
      return session;
    }
    return undefined;
  }

  async processInput(
    sessionId: string,
    input: string | ContentBlock[],
    context?: ToolExecutionContext,
  ): Promise<Message> {
    let lastMessage: Message | undefined;
    for await (const event of this.processInputStream(
      sessionId,
      input,
      context,
    )) {
      if (event.type === "response_complete") {
        lastMessage = (event.data as { message: Message }).message;
      }
    }
    if (!lastMessage) {
      throw new Error("No response generated");
    }
    return lastMessage;
  }

  async *processInputStream(
    sessionId: string,
    input: string | ContentBlock[],
    context?: ToolExecutionContext,
  ): AsyncIterable<AgentEvent> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.lastActiveAt = new Date();
    this.memoryStore.saveSession(session).catch(() => {});

    // Merge orchestrator-provided callbacks into the context
    const memoryStore = this.memoryStore;
    const mergedContext: ToolExecutionContext = {
      ...context,
      saveMemory: async (content, type) => {
        const memType = type ?? "fact";
        // Dedup: skip if a similar memory already exists
        const similar = await memoryStore.findSimilar(content, memType, 0.75);
        if (similar) {
          if (0.8 > similar.entry.importance) {
            await memoryStore.update(similar.entry.id, { importance: 0.8 });
          }
          return;
        }
        await memoryStore.add({
          type: memType,
          content,
          importance: 0.8,
        });
      },
      scheduler: this.scheduler,
      planner: this.planner,
      skillRegistry: this.skillRegistry,
      delegateTask: (task: string) => this.runSubAgent(task, context),
    };

    const inputHasImage = hasImage(input);
    let effectiveProvider: LLMProvider;

    if (inputHasImage && this.visionProvider) {
      effectiveProvider = this.visionProvider;
      console.log(
        `[orchestrator] Image detected → using ${effectiveProvider.name}`,
      );
    } else if (this.fastProvider && isSimpleChat(input)) {
      effectiveProvider = this.fastProvider;
      console.log(
        `[orchestrator] Simple chat → using fast provider ${effectiveProvider.name}`,
      );
    } else {
      effectiveProvider = this.provider;
    }

    const loop = this.createAgentLoop(effectiveProvider);
    this.activeLoops.set(sessionId, loop);
    try {
      yield* loop.runStream(input, session.conversationId, mergedContext);
    } finally {
      this.activeLoops.delete(sessionId);
      // Clean up temp Python scripts after agent loop completes
      this.cleanupTmpScripts();
    }

    // Background memory extraction: on the 1st turn and every N turns after
    const count = (this.turnCounters.get(session.conversationId) ?? 0) + 1;
    this.turnCounters.set(session.conversationId, count);
    if (count === 1 || count % EXTRACT_EVERY_N_TURNS === 0) {
      this.memoryExtractor
        .processConversation(session.conversationId)
        .then((n) => {
          if (n > 0) console.log(`[memory] Extracted ${n} memories`);
        })
        .catch((err) => {
          console.error("[memory] Extraction failed:", err);
        });
    }

    if (count === 1 && session.title === undefined) {
      const rawText =
        typeof input === "string"
          ? input
          : input
              .filter(
                (b): b is { type: "text"; text: string } => b.type === "text",
              )
              .map((b) => b.text)
              .join("");
      session.title = rawText.slice(0, 50).trim() || "New Chat";
      this.memoryStore.saveSession(session).catch(() => {});
    }
  }

  async listSessions(): Promise<Session[]> {
    // 优先从 SQLite 获取完整列表
    try {
      const stored = await this.memoryStore.listSessions();
      if (stored && stored.length > 0) return stored;
    } catch {}
    return Array.from(this.sessions.values());
  }

  stopSession(sessionId: string): boolean {
    const loop = this.activeLoops.get(sessionId);
    if (loop) {
      loop.stop();
      return true;
    }
    return false;
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    await this.memoryStore.deleteSession(sessionId);
  }

  setModel(model: string): void {
    if (!this.agentConfig) this.agentConfig = {};
    this.agentConfig.model = model;
  }

  /**
   * Spawn an independent sub-agent with its own conversation context.
   * The sub-agent shares provider/tools but has isolated history.
   * delegateTask is NOT passed to prevent infinite recursion.
   */
  private async runSubAgent(
    task: string,
    parentContext?: ToolExecutionContext,
  ): Promise<string> {
    const subConvId = generateId();
    const subContext: ToolExecutionContext = {
      sendFile: parentContext?.sendFile,
      sentFiles: parentContext?.sentFiles,
      promptUser: parentContext?.promptUser,
      notifyUser: parentContext?.notifyUser,
      saveMemory: parentContext?.saveMemory
        ? parentContext.saveMemory
        : undefined,
      scheduler: this.scheduler,
      skillRegistry: this.skillRegistry,
      // No delegateTask — prevents recursion
    };

    const contextManager = new SimpleContextManager({
      systemPrompt:
        "You are a focused sub-agent. Complete the task concisely. No greetings, no explanations — just do it and report the result.",
      memoryStore: this.memoryStore,
      skillRegistry: this.skillRegistry,
      provider: this.fastProvider ?? this.provider,
    });

    const loop = new SimpleAgentLoop({
      provider: this.provider,
      toolRegistry: this.toolRegistry,
      contextManager,
      memoryStore: this.memoryStore,
      config: { ...this.agentConfig, maxIterations: 8 },
    });

    const message = await loop.run(task, subConvId, subContext);

    // Extract text from response
    if (typeof message.content === "string") return message.content;
    return (message.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
  }

  /** Remove *.py temp scripts from tmpDir (fire-and-forget) */
  private cleanupTmpScripts(): void {
    if (!this.tmpDir) return;
    try {
      const files = readdirSync(this.tmpDir);
      for (const f of files) {
        if (f.endsWith(".py")) {
          try {
            unlinkSync(join(this.tmpDir, f));
          } catch {}
        }
      }
    } catch {}
  }

  private createAgentLoop(provider?: LLMProvider): SimpleAgentLoop {
    const effectiveProvider = provider ?? this.provider;
    const contextManager = new SimpleContextManager({
      systemPrompt: this.systemPrompt,
      memoryStore: this.memoryStore,
      skillRegistry: this.skillRegistry,
      provider: this.fastProvider ?? this.provider,
    });

    return new SimpleAgentLoop({
      provider: effectiveProvider,
      toolRegistry: this.toolRegistry,
      contextManager,
      memoryStore: this.memoryStore,
      config: this.agentConfig,
    });
  }
}

/** Check whether the user input contains at least one image block */
function hasImage(input: string | ContentBlock[]): boolean {
  if (typeof input === "string") return false;
  return input.some((b) => b.type === "image");
}

/** Check if input is simple chat (short text, no file paths or code indicators) */
function isSimpleChat(input: string | ContentBlock[]): boolean {
  const text =
    typeof input === "string"
      ? input
      : input
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("");
  // Short messages without technical indicators
  if (text.length > 200) return false;
  if (/[{}\[\]`]|https?:\/\/|data\/|\/[a-z]/i.test(text)) return false;
  return true;
}

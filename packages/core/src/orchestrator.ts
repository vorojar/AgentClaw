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

/** How many user turns between automatic memory extraction runs */
const EXTRACT_EVERY_N_TURNS = 3;

export class SimpleOrchestrator implements Orchestrator {
  private sessions = new Map<string, Session>();
  private turnCounters = new Map<string, number>();
  private provider: LLMProvider;
  private visionProvider?: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private memoryStore: MemoryStore;
  private memoryExtractor: MemoryExtractor;
  private agentConfig?: Partial<AgentConfig>;
  private systemPrompt?: string;
  private scheduler?: ToolExecutionContext["scheduler"];
  private planner?: ToolExecutionContext["planner"];
  private skillRegistry?: SkillRegistryImpl;

  constructor(options: {
    provider: LLMProvider;
    visionProvider?: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    memoryStore: MemoryStore;
    agentConfig?: Partial<AgentConfig>;
    systemPrompt?: string;
    scheduler?: ToolExecutionContext["scheduler"];
    planner?: ToolExecutionContext["planner"];
    skillRegistry?: SkillRegistryImpl;
  }) {
    this.provider = options.provider;
    this.visionProvider = options.visionProvider;
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
  }

  async createSession(): Promise<Session> {
    const session: Session = {
      id: generateId(),
      conversationId: generateId(),
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    return this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.lastActiveAt = new Date();

    // Merge orchestrator-provided callbacks into the context
    const memoryStore = this.memoryStore;
    const mergedContext: ToolExecutionContext = {
      ...context,
      saveMemory: async (content, type) => {
        await memoryStore.add({
          type: type ?? "fact",
          content,
          importance: 0.8,
        });
      },
      scheduler: this.scheduler,
      planner: this.planner,
    };

    const inputHasImage = hasImage(input);
    const effectiveProvider =
      inputHasImage && this.visionProvider
        ? this.visionProvider
        : this.provider;

    if (inputHasImage) {
      console.log(
        `[orchestrator] Image detected in input. visionProvider=${this.visionProvider ? "yes" : "NO"} → using ${effectiveProvider.name}`,
      );
    }

    const loop = this.createAgentLoop(effectiveProvider);
    yield* loop.runStream(input, session.conversationId, mergedContext);

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
  }

  async listSessions(): Promise<Session[]> {
    return Array.from(this.sessions.values());
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  private createAgentLoop(provider?: LLMProvider): SimpleAgentLoop {
    const effectiveProvider = provider ?? this.provider;
    const contextManager = new SimpleContextManager({
      systemPrompt: this.systemPrompt,
      memoryStore: this.memoryStore,
      skillRegistry: this.skillRegistry,
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

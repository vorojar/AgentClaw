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
  private toolRegistry: ToolRegistryImpl;
  private memoryStore: MemoryStore;
  private memoryExtractor: MemoryExtractor;
  private agentConfig?: Partial<AgentConfig>;
  private systemPrompt?: string;
  private scheduler?: ToolExecutionContext["scheduler"];

  constructor(options: {
    provider: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    memoryStore: MemoryStore;
    agentConfig?: Partial<AgentConfig>;
    systemPrompt?: string;
    scheduler?: ToolExecutionContext["scheduler"];
  }) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.memoryStore = options.memoryStore;
    this.memoryExtractor = new MemoryExtractor({
      provider: options.provider,
      memoryStore: options.memoryStore,
    });
    this.agentConfig = options.agentConfig;
    this.systemPrompt = options.systemPrompt;
    this.scheduler = options.scheduler;
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
    };

    const loop = this.createAgentLoop();
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

  private createAgentLoop(): SimpleAgentLoop {
    const contextManager = new SimpleContextManager({
      systemPrompt: this.systemPrompt,
      memoryStore: this.memoryStore,
    });

    return new SimpleAgentLoop({
      provider: this.provider,
      toolRegistry: this.toolRegistry,
      contextManager,
      memoryStore: this.memoryStore,
      config: this.agentConfig,
    });
  }
}

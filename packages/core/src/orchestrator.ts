import type {
  Orchestrator,
  Session,
  Message,
  AgentEvent,
  LLMProvider,
  MemoryStore,
  AgentConfig,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import { generateId } from "@agentclaw/providers";
import { SimpleAgentLoop } from "./agent-loop.js";
import { SimpleContextManager } from "./context-manager.js";

export class SimpleOrchestrator implements Orchestrator {
  private sessions = new Map<string, Session>();
  private provider: LLMProvider;
  private toolRegistry: ToolRegistryImpl;
  private memoryStore: MemoryStore;
  private agentConfig?: Partial<AgentConfig>;
  private systemPrompt?: string;

  constructor(options: {
    provider: LLMProvider;
    toolRegistry: ToolRegistryImpl;
    memoryStore: MemoryStore;
    agentConfig?: Partial<AgentConfig>;
    systemPrompt?: string;
  }) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.memoryStore = options.memoryStore;
    this.agentConfig = options.agentConfig;
    this.systemPrompt = options.systemPrompt;
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

  async processInput(sessionId: string, input: string): Promise<Message> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.lastActiveAt = new Date();

    const loop = this.createAgentLoop();
    return loop.run(input, session.conversationId);
  }

  async *processInputStream(
    sessionId: string,
    input: string,
  ): AsyncIterable<AgentEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.lastActiveAt = new Date();

    const loop = this.createAgentLoop();
    yield* loop.runStream(input, session.conversationId);
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

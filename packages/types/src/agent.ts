import type { Message, Conversation } from "./message.js";
import type { LLMProvider } from "./llm.js";
import type { ToolRegistry } from "./tool.js";
import type { MemoryStore } from "./memory.js";

/** Agent loop state */
export type AgentState =
  | "idle"
  | "thinking"
  | "tool_calling"
  | "responding"
  | "error";

/** Agent loop event types */
export type AgentEventType =
  | "state_change"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "response_chunk"
  | "response_complete"
  | "error";

/** Agent event */
export interface AgentEvent {
  type: AgentEventType;
  data: unknown;
  timestamp: Date;
}

/** Agent event listener */
export type AgentEventListener = (event: AgentEvent) => void;

/** Configuration for the agent loop */
export interface AgentConfig {
  /** Maximum iterations per turn (prevent infinite loops) */
  maxIterations: number;
  /** Default system prompt */
  systemPrompt: string;
  /** Whether to stream responses */
  streaming: boolean;
  /** Temperature for LLM calls */
  temperature?: number;
  /** Maximum tokens for LLM response */
  maxTokens?: number;
}

/** The core agent loop */
export interface AgentLoop {
  readonly state: AgentState;
  readonly config: AgentConfig;

  /** Process a user message and return the response */
  run(input: string, conversationId?: string): Promise<Message>;

  /** Process with streaming */
  runStream(input: string, conversationId?: string): AsyncIterable<AgentEvent>;

  /** Stop the current execution */
  stop(): void;

  /** Listen for events */
  on(listener: AgentEventListener): () => void;
}

/** Context manager — builds context for LLM calls */
export interface ContextManager {
  /** Build the full context (system prompt + history + memories + skills) */
  buildContext(
    conversationId: string,
    currentInput: string,
  ): Promise<{
    systemPrompt: string;
    messages: Message[];
  }>;
}

/** Session — represents a user session */
export interface Session {
  id: string;
  conversationId: string;
  createdAt: Date;
  lastActiveAt: Date;
  metadata?: Record<string, unknown>;
}

/** Orchestrator — top-level coordinator */
export interface Orchestrator {
  /** Start a new session */
  createSession(): Promise<Session>;

  /** Get or resume an existing session */
  getSession(sessionId: string): Promise<Session | undefined>;

  /** Process user input within a session */
  processInput(sessionId: string, input: string): Promise<Message>;

  /** Process with streaming */
  processInputStream(
    sessionId: string,
    input: string,
  ): AsyncIterable<AgentEvent>;

  /** List active sessions */
  listSessions(): Promise<Session[]>;

  /** Close a session */
  closeSession(sessionId: string): Promise<void>;
}

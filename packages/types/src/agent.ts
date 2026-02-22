import type { Message, Conversation, ContentBlock } from "./message.js";
import type { LLMProvider } from "./llm.js";
import type { ToolRegistry, ToolExecutionContext } from "./tool.js";
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
  /** Override model name (passed to provider per-request) */
  model?: string;
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
  run(
    input: string | ContentBlock[],
    conversationId?: string,
    context?: ToolExecutionContext,
  ): Promise<Message>;

  /** Process with streaming */
  runStream(
    input: string | ContentBlock[],
    conversationId?: string,
    context?: ToolExecutionContext,
  ): AsyncIterable<AgentEvent>;

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
    currentInput: string | ContentBlock[],
  ): Promise<{
    systemPrompt: string;
    messages: Message[];
    skillMatch?: { name: string; confidence: number };
  }>;
}

/** Session — represents a user session */
export interface Session {
  id: string;
  conversationId: string;
  createdAt: Date;
  lastActiveAt: Date;
  title?: string;
  metadata?: Record<string, unknown>;
}

/** Orchestrator — top-level coordinator */
export interface Orchestrator {
  /** Start a new session */
  createSession(): Promise<Session>;

  /** Get or resume an existing session */
  getSession(sessionId: string): Promise<Session | undefined>;

  /** Process user input within a session（支持文本或多模态内容） */
  processInput(
    sessionId: string,
    input: string | ContentBlock[],
    context?: ToolExecutionContext,
  ): Promise<Message>;

  /** Process with streaming（支持文本或多模态内容） */
  processInputStream(
    sessionId: string,
    input: string | ContentBlock[],
    context?: ToolExecutionContext,
  ): AsyncIterable<AgentEvent>;

  /** List active sessions */
  listSessions(): Promise<Session[]>;

  /** Stop a running session */
  stopSession(sessionId: string): boolean;

  /** Close a session */
  closeSession(sessionId: string): Promise<void>;
}

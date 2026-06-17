import type { Message, ContentBlock } from "./message.js";
import type { ConversationTree, SessionData } from "./memory.js";
import type { ToolExecutionContext } from "./tool.js";

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
  | "handoff"
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
  /** Maximum real LLM calls per turn, including rollback retries */
  maxLlmCalls?: number;
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
    options?: {
      preSelectedSkillName?: string;
      /** Skip memory search & skill injection — reuse cached dynamic prefix (for agent loop iteration 2+) */
      reuseContext?: boolean;
      /** Memory namespace for per-agent isolation (Hive) */
      memoryNamespace?: string;
      /** Skills to exclude from catalog (Hive per-agent blacklist) */
      disabledSkills?: string[];
    },
  ): Promise<{
    systemPrompt: string;
    messages: Message[];
    skillMatch?: { name: string; confidence: number };
  }>;

  /** Clear cached context for a conversation (call on session close) */
  clearConversationCache?(conversationId: string): void;
}

/** Session — represents a user session (alias for SessionData) */
export type Session = SessionData;

/** Per-agent API key */
export interface AgentApiKey {
  /** Unique key identifier */
  keyId: string;
  /** The actual key value (format: "ac_<agentId>_<random>") */
  key: string;
  /** Human-readable label (e.g., "production", "testing") */
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

/** Parameter definition for HTTP API knowledge source */
export interface HttpApiParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  in: "query" | "body" | "path";
}

/** HTTP API knowledge source configuration */
export interface HttpApiSourceConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  parameters: HttpApiParameter[];
  /** jq/jsonpath expression to extract key fields from response */
  responseMapping?: string;
}

/** File-based knowledge source configuration (RAG) */
export interface FileSourceConfig {
  /** Original filename */
  filename: string;
  /** Stored file path (relative to agent knowledge dir) */
  storedPath: string;
  /** File size in bytes */
  fileSize: number;
  /** Number of chunks after processing */
  chunkCount: number;
  /** Chunk size in characters */
  chunkSize?: number;
  /** Top-K results to return per query */
  topK?: number;
}

/** Knowledge source — connects agent to external data */
export interface KnowledgeSource {
  id: string;
  /** Source type */
  type: "http_api" | "file";
  /** Tool name the LLM will see (e.g., "check_inventory") */
  name: string;
  /** Description for the LLM to understand when to use it */
  description: string;
  config: HttpApiSourceConfig | FileSourceConfig;
  enabled: boolean;
}

/** Agent profile — defines a persona with custom soul, model, tools */
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  avatar: string;
  soul: string;
  model?: string;
  tools?: string[];
  maxIterations?: number;
  temperature?: number;
  sortOrder?: number;
  /** Per-agent API keys for Hive API access */
  apiKeys?: AgentApiKey[];
  /** Memory namespace for isolation (defaults to agent id) */
  memoryNamespace?: string;
  /** Skills to disable for this agent */
  disabledSkills?: string[];
  /** Whether this agent is published (API accessible) */
  isPublished?: boolean;
  /** Rate limits for API access */
  rateLimits?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
  };
  /** Knowledge sources — external APIs the agent can query */
  knowledgeSources?: KnowledgeSource[];
  /** Whether this agent appears in the Chat page agent selector (default true) */
  showInChat?: boolean;
  /** Whether this agent can be a handoff target for other agents (default false) */
  allowHandoff?: boolean;
}

/** Orchestrator — top-level coordinator */
export interface Orchestrator {
  /** Start a new session */
  createSession(metadata?: Record<string, unknown>): Promise<Session>;

  /** Get or resume an existing session */
  getSession(sessionId: string): Promise<Session | undefined>;

  /** Update a session and keep orchestrator cache in sync */
  updateSession(
    sessionId: string,
    updates: Partial<
      Pick<Session, "title" | "status" | "projectId" | "metadata">
    >,
  ): Promise<Session | undefined>;

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

  /** Read the full conversation tree for a session */
  getSessionTree(sessionId: string): Promise<ConversationTree | undefined>;

  /** Move a session to a previous turn or clear its active branch pointer */
  setSessionActiveLeaf(
    sessionId: string,
    turnId: string | null,
  ): Promise<ConversationTree | undefined>;

  /** List active sessions */
  listSessions(): Promise<Session[]>;

  /** Stop a running session */
  stopSession(sessionId: string): boolean;

  /** Return IDs of sessions that have an active agent loop running */
  getActiveSessionIds(): string[];

  /** Close a session */
  closeSession(sessionId: string): Promise<void>;
}

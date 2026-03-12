import type { Message, ContentBlock } from "./message.js";
import type { SessionData } from "./memory.js";
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
    },
  ): Promise<{
    systemPrompt: string;
    messages: Message[];
    skillMatch?: { name: string; confidence: number };
  }>;
}

/** Session — represents a user session (alias for SessionData) */
export type Session = SessionData;

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
}

/* ── Workflow (deterministic orchestration) ─────────────── */

/** A single step in a deterministic workflow */
export interface WorkflowStep {
  /** Unique step identifier (used to reference output in templates) */
  id: string;
  /** Step type */
  type: "tool" | "parallel";
  /** For type=tool: tool name to invoke */
  toolName?: string;
  /** For type=tool: static input (supports {{stepId.content}} templates) */
  toolInput?: Record<string, unknown>;
  /** For type=parallel: sub-steps to run concurrently */
  steps?: WorkflowStep[];
  /** Error handling: "stop" aborts workflow, "continue" proceeds (default: "stop") */
  onError?: "stop" | "continue";
  /** Optional condition: template expression that must be truthy to execute */
  condition?: string;
}

/** A complete workflow definition */
export interface WorkflowDefinition {
  name: string;
  description?: string;
  /** Steps executed sequentially (unless step.type is "parallel") */
  steps: WorkflowStep[];
}

/** Result of a single workflow step */
export interface WorkflowStepResult {
  stepId: string;
  content: string;
  isError: boolean;
  durationMs: number;
}

/** Result of a full workflow execution */
export interface WorkflowResult {
  success: boolean;
  stepResults: WorkflowStepResult[];
  totalDurationMs: number;
  error?: string;
}

/** Orchestrator — top-level coordinator */
export interface Orchestrator {
  /** Start a new session */
  createSession(metadata?: Record<string, unknown>): Promise<Session>;

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

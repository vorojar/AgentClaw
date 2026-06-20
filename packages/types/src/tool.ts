import type {
  SkillChangeInput,
  SkillChangeQuery,
  SkillChangeRecord,
  SkillUsageEvent,
  SkillUsageStats,
  EvolutionEventInput,
  EvolutionEventQuery,
  EvolutionEventRecord,
  EvolutionRunInput,
  EvolutionRunQuery,
  EvolutionRunRecord,
  EvolutionRunUpdate,
} from "./memory.js";

/** JSON Schema for tool parameters */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
      items?: { type: string };
    }
  >;
  required?: string[];
}

/** Tool definition — describes a tool's interface */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

/** Result of a tool execution */
export interface ToolEffect {
  kind:
    | "none"
    | "read"
    | "write"
    | "delete"
    | "send"
    | "schedule"
    | "memory"
    | "external";
  target?: string;
  reversible: boolean;
  cleanupId?: string;
  deliverable?: boolean;
  verified?: boolean;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
  /** Deterministic side-effect contract for trace, cleanup, and delivery checks */
  effect?: ToolEffect;
  /** Signal agent-loop to skip next LLM call and auto-complete the response */
  autoComplete?: boolean;
  /** Signal agent-loop to hand off conversation to another agent */
  handoffTo?: string;
}

/** Tool categories */
export type ToolCategory = "builtin" | "external" | "mcp";

/** Execution context passed through the call chain to tools */
export interface ToolExecutionContext {
  /** Ask the user a question and wait for their answer (implemented by gateway) */
  promptUser?: (question: string) => Promise<string>;
  /** Send a notification to the user (fire-and-forget, for reminders etc.) */
  notifyUser?: (message: string) => Promise<void>;
  /** Stream a text chunk directly into the user's chat bubble (bypasses outer LLM) */
  streamText?: (text: string) => void;
  /** Send a file to the user (implemented by gateway) */
  sendFile?: (filePath: string, caption?: string) => Promise<void>;
  /** Files sent during tool execution (populated by sendFile, consumed by agent-loop for persistence) */
  sentFiles?: Array<{ url: string; filename: string }>;
  /** Save a piece of information to long-term memory (provided by orchestrator) */
  saveMemory?: (
    content: string,
    type?: "identity" | "fact" | "preference" | "entity" | "episodic",
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  /** Task scheduler for recurring tasks (provided by orchestrator) */
  scheduler?: {
    create(input: {
      name: string;
      cron: string;
      action: string;
      enabled: boolean;
      oneShot?: boolean;
    }): { id: string; name: string; nextRunAt?: Date };
    list(): Array<{
      id: string;
      name: string;
      cron: string;
      action: string;
      enabled: boolean;
      nextRunAt?: Date;
      lastRunAt?: Date;
    }>;
    delete(id: string): boolean;
  };
  /** Skill registry for use_skill tool */
  skillRegistry?: {
    get(id: string):
      | {
          id?: string;
          name: string;
          description?: string;
          instructions: string;
          path?: string;
        }
      | undefined;
    list(): Array<{
      id: string;
      name: string;
      description: string;
      enabled: boolean;
    }>;
  };
  /** Active skills directory for skill_manage and skill_curator */
  skillsDir?: string;
  /** Archive directory for retired skills */
  skillArchiveDir?: string;
  /** Backup directory for curator / lifecycle snapshots */
  skillBackupDir?: string;
  /** Skill usage telemetry sink */
  recordSkillUsage?: (event: SkillUsageEvent) => Promise<void>;
  /** Skill lifecycle telemetry sink */
  recordSkillChange?: (change: SkillChangeInput) => Promise<SkillChangeRecord>;
  /** Skill usage telemetry reader */
  listSkillUsageStats?: (limit?: number) => Promise<SkillUsageStats[]>;
  /** Skill lifecycle telemetry reader */
  listSkillChangeHistory?: (
    query?: SkillChangeQuery,
  ) => Promise<SkillChangeRecord[]>;
  /** 进化账本运行写入器 */
  recordEvolutionRun?: (
    input: EvolutionRunInput,
  ) => Promise<EvolutionRunRecord>;
  /** 进化账本运行更新器 */
  updateEvolutionRun?: (
    id: string,
    updates: EvolutionRunUpdate,
  ) => Promise<EvolutionRunRecord | undefined>;
  /** 进化账本事件写入器 */
  recordEvolutionEvent?: (
    event: EvolutionEventInput,
  ) => Promise<EvolutionEventRecord>;
  /** 进化账本运行读取器 */
  listEvolutionRuns?: (
    query?: EvolutionRunQuery,
  ) => Promise<EvolutionRunRecord[]>;
  /** 进化账本事件读取器 */
  listEvolutionEvents?: (
    query?: EvolutionEventQuery,
  ) => Promise<EvolutionEventRecord[]>;
  /** Update the todo progress list (displayed in frontend) */
  todoNotify?: (items: Array<{ text: string; done: boolean }>) => void;
  /** Pre-selected skill name from UI chips — inject instructions directly, skip use_skill round */
  preSelectedSkillName?: string;
  /** Original user message text before parseUserContent transformation (for DB storage) */
  originalUserText?: string;
  /** Explicit parent turn for the next user turn, used by branch recovery reruns */
  conversationParentTurnId?: string | null;
  /** Explicit branch id for the next user turn */
  conversationBranchId?: string;
  /** Per-session working directory (absolute path, forward slashes) */
  workDir?: string;
  /** Compiled ignore rules from .agentclawignore — used by file tools to block sensitive paths */
  ignoreCheck?: (relativePath: string) => boolean;
  /** Tool execution hooks (before/after) */
  toolHooks?: ToolHooks;
  /** Tool access policy (allow/deny lists) */
  toolPolicy?: ToolPolicy;
  /** Abort signal — tools should listen to this and terminate early when user stops the agent */
  abortSignal?: AbortSignal;
  /** Sub-agent manager for spawning/managing sub-agents */
  subAgentManager?: import("./subagent.js").SubAgentManager;
  /** Available agents for handoff tool */
  agents?: Array<{ id: string; name: string; description: string }>;
  /** Search conversation history (turns) by keyword */
  searchHistory?: (
    query: string,
    limit?: number,
  ) => Promise<Array<{ role: string; content: string; createdAt: string }>>;
  /** Search or read prior conversation sessions for cross-session recovery */
  sessionSearch?: (input: {
    query?: string;
    sessionId?: string;
    aroundTurnId?: string;
    limit?: number;
    window?: number;
  }) => Promise<{
    mode: "discovery" | "read" | "scroll";
    results?: Array<{
      sessionId: string;
      conversationId: string;
      title?: string;
      updatedAt: string;
      snippet?: string;
      matchTurnId?: string;
      messagesBefore?: number;
      messagesAfter?: number;
      bookendStart: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
      }>;
      messages: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
        anchor?: boolean;
      }>;
      bookendEnd: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
      }>;
    }>;
    session?: {
      sessionId: string;
      conversationId: string;
      title?: string;
      updatedAt: string;
      messagesBefore?: number;
      messagesAfter?: number;
      messages: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
        anchor?: boolean;
      }>;
    };
  }>;
  /** Source channel (web, telegram, dingtalk, etc.) — propagated to traces */
  channel?: string;
  /** 当前 trace ID，用于审计关联 */
  traceId?: string;
  /** 当前 conversation ID，用于审计关联 */
  conversationId?: string;
  /** Queue for background task results — shell tool pushes, agent-loop drains */
  backgroundQueue?: Array<{
    id: string;
    command: string;
    content: string;
    isError: boolean;
    completedAt: Date;
  }>;
  /** Persist a long-running background job when it starts. */
  recordBackgroundJob?: (job: {
    id: string;
    command: string;
    status: "running" | "completed" | "failed";
    pid?: number;
    conversationId?: string;
    traceId?: string;
    agentId?: string;
    startedAt: Date;
  }) => Promise<void> | void;
  /** Persist background job completion/failure. */
  updateBackgroundJob?: (
    id: string,
    updates: {
      status: "running" | "completed" | "failed";
      exitCode?: number | null;
      output?: string;
      error?: string | null;
      completedAt?: Date;
    },
  ) => Promise<void> | void;
  /** Memory namespace for per-agent isolation (Hive) */
  memoryNamespace?: string;
  /** Skills disabled for this agent (Hive per-agent blacklist) */
  disabledSkills?: string[];
  /** Agent ID for trace tracking (Hive) */
  agentId?: string;
  /** Force-compress conversation context (for compact tool) */
  compactContext?: () => Promise<{ deleted: number; summary: string }>;
  /** Search long-term memory (read-only, for recall tool) */
  searchMemory?: (
    query: string,
    options?: { type?: string; limit?: number },
  ) => Promise<
    Array<{
      content: string;
      type: string;
      importance: number;
      createdAt: string;
    }>
  >;
  /** Read a captured observation by canonical id. */
  getObservation?: (
    id: string,
  ) => Promise<{ id: string; raw: string } | undefined>;
  /** Audit an observation_read result. */
  recordObservationRead?: (record: {
    id: string;
    returnedChars: number;
    query?: string;
    offset?: number;
    length?: number;
  }) => Promise<void>;
}

/** A tool that can be executed */
export interface Tool extends ToolDefinition {
  category: ToolCategory;
  /** Pure tools (read-only, no side effects) can be executed in parallel when
   *  the LLM requests multiple tool calls in a single response. Default: false. */
  pure?: boolean;
  execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult>;
}

/** Tool registry — manages available tools */
export interface ToolRegistry {
  /** Register a tool */
  register(tool: Tool): void;

  /** Unregister a tool */
  unregister(name: string): void;

  /** Get a tool by name */
  get(name: string): Tool | undefined;

  /** List all registered tools */
  list(): Tool[];

  /** List tool definitions (for LLM) */
  definitions(): ToolDefinition[];

  /** Execute a tool by name */
  execute(
    name: string,
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult>;
}

/** Hook called before/after tool execution */
export interface ToolHooks {
  /** Called before tool execution. Return modified input, or null to block execution. */
  before?: (call: {
    name: string;
    input: Record<string, unknown>;
  }) => Promise<{ name: string; input: Record<string, unknown> } | null>;
  /** Called after tool execution. Can modify the result. */
  after?: (
    call: { name: string; input: Record<string, unknown> },
    result: ToolResult,
  ) => Promise<ToolResult>;
  /** Called when LLM wants to stop — return "continue" to force another iteration */
  beforeReturn?: (ctx: {
    response: string;
    runtimeHints: string[];
    todoItems: Array<{ text: string; done: boolean }>;
  }) => Promise<{ action: "return" } | { action: "continue"; hint: string }>;
}

/** Tool access policy */
export interface ToolPolicy {
  /** If set, only these tools are allowed */
  allow?: string[];
  /** These tools are always blocked */
  deny?: string[];
}

/** Hook called at the start of each agent-loop iteration */
export type OnIterationHook = (context: {
  iteration: number;
  runtimeHints: string[];
}) => Promise<void>;

/** Hook called when LLM wants to stop (toolCalls.length === 0) before returning */
export type BeforeReturnHook = (context: {
  response: string;
  runtimeHints: string[];
  todoItems: Array<{ text: string; done: boolean }>;
}) => Promise<{ action: "return" } | { action: "continue"; hint: string }>;

/** MCP Server connection configuration */
export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

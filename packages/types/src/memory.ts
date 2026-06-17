import type { MessageRole } from "./message.js";
import type { ToolEffect } from "./tool.js";

/** Memory entry types */
export type MemoryType =
  | "identity"
  | "fact"
  | "preference"
  | "entity"
  | "episodic";

/** A single memory entry */
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  /** Turn ID that generated this memory */
  sourceTurnId?: string;
  /** Importance score (0-1) */
  importance: number;
  /** Vector embedding for semantic search */
  embedding?: number[];
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  metadata?: Record<string, unknown>;
}

/** Options for memory retrieval */
export interface MemoryQuery {
  /** Text query for semantic search */
  query?: string;
  /** Filter by memory type */
  type?: MemoryType;
  /** Maximum results to return */
  limit?: number;
  /** Minimum importance threshold */
  minImportance?: number;
  /** Weight for BM25 full-text search score (default 0.2) */
  bm25Weight?: number;
  /** Weight for semantic/vector similarity (default 0.4) */
  semanticWeight?: number;
  /** Weight for recency (default 0.15) */
  recencyWeight?: number;
  /** Weight for importance (default 0.25) */
  importanceWeight?: number;
  /** Memory namespace for agent isolation (default: "default") */
  namespace?: string;
}

/** Memory retrieval result with relevance score */
export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

/** A single step in a trace */
export interface TraceStep {
  type:
    | "llm_call"
    | "tool_call"
    | "tool_result"
    | "runtime_config"
    | "budget_event"
    | "completion_contract";
  [key: string]: unknown;
}

/** A full interaction trace for debugging */
export interface Trace {
  id: string;
  conversationId: string;
  userInput: string;
  systemPrompt?: string;
  skillMatch?: string;
  steps: TraceStep[];
  response?: string;
  effects?: ToolEffect[];
  model?: string;
  /** Source channel: web, telegram, dingtalk, feishu, qq, whatsapp, wecom, api */
  channel?: string;
  /** Agent ID for per-agent usage tracking (Hive) */
  agentId?: string;
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  durationMs: number;
  error?: string;
  /** Suggested branch point when this trace encountered recoverable failure */
  branchRecovery?: BranchRecoverySuggestion;
  createdAt: Date;
}

export type BranchRecoveryReason = "tool_error" | "loop_error" | "llm_error";

export interface BranchRecoverySuggestion {
  traceId: string;
  conversationId: string;
  fromTurnId: string;
  reason: BranchRecoveryReason;
  message: string;
  failedToolNames?: string[];
  createdAt: Date;
}

/** A project groups related sessions, memory, and instructions */
export interface Project {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
  sessionCount?: number;
}

/** Session status for task-oriented UI */
export type SessionStatus = "active" | "waiting" | "done";

/** Session data shared between MemoryStore and Orchestrator */
export interface SessionData {
  id: string;
  conversationId: string;
  createdAt: Date;
  lastActiveAt: Date;
  title?: string;
  status?: SessionStatus;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

export type SkillChangeAction =
  | "create"
  | "patch"
  | "write_file"
  | "archive"
  | "delete"
  | "backup"
  | "curate";

export interface SkillUsageEvent {
  skillId: string;
  skillName?: string;
  success: boolean;
  error?: string;
  agentId?: string;
  usedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface SkillUsageStats {
  skillId: string;
  skillName: string;
  useCount: number;
  successCount: number;
  failureCount: number;
  lastUsedAt: Date;
  lastError?: string;
  agentId?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface SkillChangeInput {
  skillId: string;
  skillName?: string;
  action: SkillChangeAction;
  success: boolean;
  reason?: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  path?: string;
  error?: string;
  agentId?: string;
  evolutionRunId?: string;
  traceId?: string;
  conversationId?: string;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface SkillChangeRecord extends Omit<SkillChangeInput, "createdAt"> {
  id: string;
  skillName: string;
  createdAt: Date;
}

export interface SkillChangeQuery {
  skillId?: string;
  limit?: number;
}

export type EvolutionTargetType =
  | "skill"
  | "tool"
  | "prompt"
  | "memory_policy"
  | "eval"
  | "agent"
  | "other";

export type EvolutionRunStatus =
  | "proposed"
  | "baseline"
  | "applied"
  | "verified"
  | "failed"
  | "rolled_back";

export type EvolutionResult = "improved" | "neutral" | "regressed" | "unknown";

export type EvolutionEventType =
  | "proposal"
  | "baseline_eval"
  | "backup"
  | "change"
  | "static_check"
  | "capability_eval"
  | "online_regression"
  | "promote"
  | "rollback"
  | "failure";

export interface EvolutionRunInput {
  id?: string;
  targetType: EvolutionTargetType;
  targetId: string;
  status?: EvolutionRunStatus;
  result?: EvolutionResult;
  reason?: string;
  triggerTraceId?: string;
  triggerConversationId?: string;
  baselineScore?: number;
  afterScore?: number;
  regressionCount?: number;
  evalReportPath?: string;
  rollbackPath?: string;
  agentId?: string;
  startedAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface EvolutionRunRecord
  extends Omit<EvolutionRunInput, "id" | "startedAt" | "completedAt"> {
  id: string;
  status: EvolutionRunStatus;
  result: EvolutionResult;
  regressionCount: number;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EvolutionRunUpdate {
  status?: EvolutionRunStatus;
  result?: EvolutionResult;
  reason?: string;
  baselineScore?: number;
  afterScore?: number;
  regressionCount?: number;
  evalReportPath?: string;
  rollbackPath?: string;
  completedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface EvolutionRunQuery {
  targetType?: EvolutionTargetType;
  targetId?: string;
  status?: EvolutionRunStatus;
  triggerTraceId?: string;
  triggerConversationId?: string;
  limit?: number;
}

export interface EvolutionEventInput {
  runId: string;
  eventType: EvolutionEventType;
  message?: string;
  success?: boolean;
  traceId?: string;
  changeId?: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  scoreBefore?: number;
  scoreAfter?: number;
  data?: Record<string, unknown>;
  createdAt?: Date;
}

export interface EvolutionEventRecord
  extends Omit<EvolutionEventInput, "createdAt"> {
  id: string;
  success: boolean;
  createdAt: Date;
}

export interface EvolutionEventQuery {
  runId?: string;
  traceId?: string;
  limit?: number;
}

export interface Observation {
  id: string;
  traceId: string;
  stepId: string;
  toolName: string;
  inputHash: string;
  contentHash: string;
  rawPath: string;
  preview: string;
  facts: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  rawChars: number;
  promptChars: number;
  savedChars: number;
  createdAt: Date;
}

export type BackgroundJobStatus = "running" | "completed" | "failed";

export interface BackgroundJob {
  id: string;
  command: string;
  status: BackgroundJobStatus;
  pid?: number;
  conversationId?: string;
  traceId?: string;
  agentId?: string;
  exitCode?: number | null;
  output?: string;
  error?: string | null;
  startedAt: Date;
  completedAt?: Date;
}

export interface BackgroundJobInput {
  id: string;
  command: string;
  status: BackgroundJobStatus;
  pid?: number;
  conversationId?: string;
  traceId?: string;
  agentId?: string;
  startedAt: Date;
}

export interface BackgroundJobUpdate {
  status: BackgroundJobStatus;
  exitCode?: number | null;
  output?: string;
  error?: string | null;
  completedAt?: Date;
}

export type ObservationInput = Omit<Observation, "id" | "createdAt">;

export interface ObservationRead {
  id: string;
  observationId: string;
  traceId: string;
  stepId: string;
  query?: string;
  offset?: number;
  length?: number;
  returnedChars: number;
  readAt: Date;
}

export type ObservationReadInput = Omit<ObservationRead, "id" | "readAt">;

export type MemoryUsageSource =
  | "prompt_injection"
  | "active_memory"
  | "recall_tool"
  | "drill_down";

export interface MemoryUsageEvent {
  memoryId: string;
  source: MemoryUsageSource;
  conversationId?: string;
  traceId?: string;
  agentId?: string;
  usedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface MemoryUsageRecord extends Omit<MemoryUsageEvent, "usedAt"> {
  id: string;
  usedAt: Date;
}

export interface MemoryEffectivenessStats {
  memoryId: string;
  type: MemoryType;
  content: string;
  importance: number;
  status?: string;
  totalUses: number;
  activeMemoryUses: number;
  helpfulUses: number;
  pollutingUses: number;
  effectivenessRate: number;
  pollutionRate: number;
  lastUsedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface MemoryJanitorOptions {
  namespace?: string;
  minUses?: number;
  pollutionRateThreshold?: number;
  dryRun?: boolean;
}

export interface MemoryJanitorResult {
  reviewed: number;
  deprecated: number;
  deprecatedIds: string[];
}

/** Memory store interface */
export interface MemoryStore {
  /** Store a new memory (namespace for per-agent isolation, defaults to "default") */
  add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount">,
    namespace?: string,
  ): Promise<MemoryEntry>;

  /** Retrieve memories by query (namespace in query for per-agent isolation) */
  search(query: MemoryQuery): Promise<MemorySearchResult[]>;

  /** Get a specific memory by ID */
  get(id: string): Promise<MemoryEntry | undefined>;

  /** Update a memory */
  update(id: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry>;

  /** Find the most similar existing memory (semantic dedup) */
  findSimilar(
    content: string,
    type: string,
    threshold?: number,
    namespace?: string,
  ): Promise<{ entry: MemoryEntry; score: number } | null>;

  /** Delete a memory */
  delete(id: string): Promise<void>;

  /** Store conversation turn */
  addTurn(conversationId: string, turn: ConversationTurn): Promise<void>;

  /** Get conversation history */
  getHistory(
    conversationId: string,
    limit?: number,
  ): Promise<ConversationTurn[]>;

  /** Get all turns in a conversation tree plus the active leaf pointer */
  getConversationTree?(conversationId: string): Promise<ConversationTree>;

  /** Move the active branch pointer to a turn in this conversation, or clear it */
  setActiveConversationLeaf?(
    conversationId: string,
    turnId: string | null,
  ): Promise<void>;

  /** Full-text search conversation history */
  searchHistory?(
    conversationId: string,
    query: string,
    limit?: number,
  ): Promise<Array<{ role: string; content: string; createdAt: string }>>;

  /** Delete turns from a conversation starting at (inclusive) the given timestamp */
  deleteTurnsFrom?(
    conversationId: string,
    fromCreatedAt: string,
  ): Promise<number>;

  /** Save or update a session */
  saveSession(session: SessionData): Promise<void>;

  /** Get a session by ID */
  getSessionById(id: string): Promise<SessionData | null>;

  /** List all sessions ordered by last active */
  listSessions(): Promise<Array<Omit<SessionData, "metadata">>>;

  /** Delete a session */
  deleteSession(id: string): Promise<void>;

  /** Store an interaction trace */
  addTrace(trace: Trace): Promise<void>;

  /** Get a trace by ID */
  getTrace(id: string): Promise<Trace | null>;

  /** List traces with pagination */
  getTraces(
    limit?: number,
    offset?: number,
    agentId?: string,
    conversationId?: string,
  ): Promise<{ items: Trace[]; total: number }>;

  /** Create a project */
  createProject(
    project: Omit<Project, "id" | "createdAt" | "updatedAt">,
  ): Promise<Project>;

  /** Get a project by ID */
  getProject(id: string): Promise<Project | undefined>;

  /** List all projects */
  listProjects(): Promise<Project[]>;

  /** Update a project */
  updateProject(
    id: string,
    updates: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Project>;

  /** Delete a project and unlink its sessions */
  deleteProject(id: string): Promise<void>;

  /** Aggregate stats for background (hidden) sessions */
  getBackgroundStats(since: string): Promise<{
    sessions: number;
    traces: number;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  }>;

  /** Persist a long-running background job when it starts. */
  recordBackgroundJob(job: BackgroundJobInput): Promise<void>;

  /** Persist a long-running background job completion/failure. */
  updateBackgroundJob(id: string, updates: BackgroundJobUpdate): Promise<void>;

  /** Get one persisted background job by ID. */
  getBackgroundJob(id: string): Promise<BackgroundJob | null>;

  /** List recent persisted background jobs. */
  listBackgroundJobs(limit?: number): Promise<BackgroundJob[]>;

  /** Persist a new sub-agent record */
  addSubAgent(agent: {
    id: string;
    sessionId?: string;
    goal: string;
    model?: string;
  }): void;

  /** Update a sub-agent record */
  updateSubAgent(
    id: string,
    updates: {
      status?: string;
      result?: string;
      error?: string;
      tokensIn?: number;
      tokensOut?: number;
      toolsUsed?: string[];
      iterations?: number;
      completedAt?: string;
    },
  ): boolean;

  /** Record one skill load/use attempt */
  recordSkillUsage(event: SkillUsageEvent): Promise<void>;

  /** List aggregate skill usage stats ordered by recent activity */
  listSkillUsageStats(limit?: number): Promise<SkillUsageStats[]>;

  /** Record a skill lifecycle change */
  recordSkillChange(change: SkillChangeInput): Promise<SkillChangeRecord>;

  /** List skill lifecycle history */
  listSkillChangeHistory(
    query?: SkillChangeQuery,
  ): Promise<SkillChangeRecord[]>;

  /** 记录一次能力进化运行 */
  recordEvolutionRun(input: EvolutionRunInput): Promise<EvolutionRunRecord>;

  /** 更新能力进化运行状态或评测字段 */
  updateEvolutionRun(
    id: string,
    updates: EvolutionRunUpdate,
  ): Promise<EvolutionRunRecord | undefined>;

  /** 记录一条不可变的能力进化事件 */
  recordEvolutionEvent(
    event: EvolutionEventInput,
  ): Promise<EvolutionEventRecord>;

  /** 按最近更新时间列出能力进化运行 */
  listEvolutionRuns(query?: EvolutionRunQuery): Promise<EvolutionRunRecord[]>;

  /** 按创建时间列出能力进化事件 */
  listEvolutionEvents(
    query?: EvolutionEventQuery,
  ): Promise<EvolutionEventRecord[]>;

  /** 保存一次工具/环境观察结果 */
  addObservation(input: ObservationInput): Promise<Observation>;

  /** 按 ID 读取观察结果 */
  getObservation(id: string): Promise<Observation | null>;

  /** 按内容哈希查找可复用观察结果 */
  findObservationByHash(contentHash: string): Promise<Observation | null>;

  /** 记录一次观察结果读取 */
  recordObservationRead(input: ObservationReadInput): Promise<ObservationRead>;

  /** 列出观察结果读取记录 */
  listObservationReads(observationId: string): Promise<ObservationRead[]>;

  /** Record memory usage telemetry for injected/recalled/drilled-down memories. */
  recordMemoryUsage?(event: MemoryUsageEvent): Promise<MemoryUsageRecord>;

  /** Aggregate per-memory effectiveness/pollution telemetry. */
  listMemoryEffectiveness?(options?: {
    namespace?: string;
  }): Promise<MemoryEffectivenessStats[]>;

  /** Automatically deprecate memories proven harmful by usage telemetry. */
  runMemoryJanitor?(
    options?: MemoryJanitorOptions,
  ): Promise<MemoryJanitorResult>;
}

/** A single conversation turn stored in memory */
export interface ConversationTurn {
  id: string;
  conversationId: string;
  parentId?: string | null;
  branchId?: string;
  role: MessageRole;
  content: string;
  toolCalls?: string; // JSON
  toolResults?: string; // JSON
  reasoningContent?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  durationMs?: number;
  toolCallCount?: number;
  traceId?: string;
  createdAt: Date;
}

/** Full conversation tree state for branch navigation and replay */
export interface ConversationTree {
  conversationId: string;
  activeLeafId: string | null;
  turns: ConversationTurn[];
}

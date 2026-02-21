/** Memory entry types */
export type MemoryType = "fact" | "preference" | "entity" | "episodic";

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
  /** Weight for semantic similarity (default 0.5) */
  semanticWeight?: number;
  /** Weight for recency (default 0.2) */
  recencyWeight?: number;
  /** Weight for importance (default 0.3) */
  importanceWeight?: number;
}

/** Memory retrieval result with relevance score */
export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

/** A single step in a trace */
export interface TraceStep {
  type: "llm_call" | "tool_call" | "tool_result";
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
  model?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error?: string;
  createdAt: Date;
}

/** Memory store interface */
export interface MemoryStore {
  /** Store a new memory */
  add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount">,
  ): Promise<MemoryEntry>;

  /** Retrieve memories by query */
  search(query: MemoryQuery): Promise<MemorySearchResult[]>;

  /** Get a specific memory by ID */
  get(id: string): Promise<MemoryEntry | undefined>;

  /** Update a memory */
  update(id: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry>;

  /** Delete a memory */
  delete(id: string): Promise<void>;

  /** Store conversation turn */
  addTurn(conversationId: string, turn: ConversationTurn): Promise<void>;

  /** Get conversation history */
  getHistory(
    conversationId: string,
    limit?: number,
  ): Promise<ConversationTurn[]>;

  /** Store an interaction trace */
  addTrace(trace: Trace): Promise<void>;

  /** Get a trace by ID */
  getTrace(id: string): Promise<Trace | null>;

  /** List traces with pagination */
  getTraces(
    limit?: number,
    offset?: number,
  ): Promise<{ items: Trace[]; total: number }>;
}

/** A single conversation turn stored in memory */
export interface ConversationTurn {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: string; // JSON
  toolResults?: string; // JSON
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  toolCallCount?: number;
  traceId?: string;
  createdAt: Date;
}

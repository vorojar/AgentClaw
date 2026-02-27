import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  MemoryStore,
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  ConversationTurn,
  Trace,
} from "@agentclaw/types";
import { cosineSimilarity, SimpleBagOfWords } from "./embeddings.js";

/** Optional external embedding function (e.g. from an LLM provider) */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * SQLite-backed implementation of the MemoryStore interface.
 *
 * Supports hybrid retrieval:
 *   score = semantic_similarity × semanticWeight
 *         + recency × recencyWeight
 *         + importance × importanceWeight
 *
 * When no LLM embed function is provided, falls back to SimpleBagOfWords.
 */
export class SQLiteMemoryStore implements MemoryStore {
  private db: Database.Database;
  private embedFn?: EmbedFn;
  private bow: SimpleBagOfWords;

  constructor(db: Database.Database, embedFn?: EmbedFn) {
    this.db = db;
    this.embedFn = embedFn;
    this.bow = new SimpleBagOfWords(512);
  }

  /** Set or update the embedding function (e.g. after provider is ready) */
  setEmbedFn(fn: EmbedFn): void {
    this.embedFn = fn;
  }

  // ─── Memory CRUD ───────────────────────────────────────────────

  async add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount">,
  ): Promise<MemoryEntry> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Auto-generate embedding if not provided
    let embedding = entry.embedding;
    if (!embedding) {
      embedding = await this.generateEmbedding(entry.content);
    }

    this.db
      .prepare(
        `INSERT INTO memories (id, type, content, source_turn_id, importance, embedding, created_at, accessed_at, access_count, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        entry.type,
        entry.content,
        entry.sourceTurnId ?? null,
        entry.importance,
        embedding ? Buffer.from(new Float64Array(embedding).buffer) : null,
        now,
        now,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      );

    return {
      id,
      type: entry.type,
      content: entry.content,
      sourceTurnId: entry.sourceTurnId,
      importance: entry.importance,
      embedding,
      createdAt: new Date(now),
      accessedAt: new Date(now),
      accessCount: 0,
      metadata: entry.metadata,
    };
  }

  async search(query: MemoryQuery): Promise<MemorySearchResult[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.type) {
      conditions.push("type = ?");
      params.push(query.type);
    }

    if (query.minImportance !== undefined) {
      conditions.push("importance >= ?");
      params.push(query.minImportance);
    }

    // NOTE: query.query is intentionally NOT used as a SQL LIKE pre-filter.
    // LIKE '%full sentence%' eliminates almost all memories before semantic
    // scoring gets a chance to run. The query is used only for embedding-based
    // and token-overlap scoring below.

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Fetch more candidates than needed — we re-rank with hybrid scoring
    const fetchLimit = Math.max((query.limit ?? 20) * 3, 60);

    const rows = this.db
      .prepare(
        `SELECT * FROM memories ${where} ORDER BY importance DESC, accessed_at DESC LIMIT ?`,
      )
      .all(...params, fetchLimit) as MemoryRow[];

    // Hybrid scoring weights
    const wSemantic = query.semanticWeight ?? 0.5;
    const wRecency = query.recencyWeight ?? 0.2;
    const wImportance = query.importanceWeight ?? 0.3;

    // Generate query embedding for semantic scoring
    let queryEmbedding: number[] | undefined;
    if (query.query && wSemantic > 0) {
      queryEmbedding = await this.generateEmbedding(query.query);
    }

    const now = Date.now();
    const ONE_DAY_MS = 86_400_000;

    const scored: MemorySearchResult[] = rows.map((row) => {
      const entry = rowToMemoryEntry(row);

      // Semantic similarity score (0-1)
      let semanticScore = 0;
      if (queryEmbedding && entry.embedding) {
        // Pad shorter vector with zeros for cosine similarity
        const a = queryEmbedding;
        const b = entry.embedding;
        const maxLen = Math.max(a.length, b.length);
        const aPadded =
          a.length < maxLen
            ? [...a, ...new Array(maxLen - a.length).fill(0)]
            : a;
        const bPadded =
          b.length < maxLen
            ? [...b, ...new Array(maxLen - b.length).fill(0)]
            : b;
        semanticScore = Math.max(0, cosineSimilarity(aPadded, bPadded));
      } else if (query.query) {
        // Fallback: token-overlap score (works for both CJK and Latin text)
        semanticScore = tokenOverlapScore(query.query, entry.content);
      }

      // Recency score (0-1): exponential decay, half-life = 7 days
      const ageMs = now - entry.accessedAt.getTime();
      const recencyScore = Math.exp(-ageMs / (7 * ONE_DAY_MS));

      // Importance score (already 0-1)
      const importanceScore = entry.importance;

      const score =
        wSemantic * semanticScore +
        wRecency * recencyScore +
        wImportance * importanceScore;

      return { entry, score };
    });

    // Sort by hybrid score, return top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, query.limit ?? 20);
  }

  /**
   * Find the most similar existing memory (same type, above similarity threshold).
   * Returns the entry + score, or null if nothing similar enough exists.
   */
  async findSimilar(
    content: string,
    type: string,
    threshold = 0.75,
  ): Promise<{ entry: MemoryEntry; score: number } | null> {
    const results = await this.search({
      query: content,
      type: type as MemoryEntry["type"],
      limit: 5,
      semanticWeight: 1.0,
      recencyWeight: 0,
      importanceWeight: 0,
    });
    if (results.length === 0) return null;

    // Also check exact text match (normalized) as a guaranteed dedup
    const normalized = content.toLowerCase().trim();
    for (const r of results) {
      if (r.entry.content.toLowerCase().trim() === normalized) {
        return { entry: r.entry, score: 1.0 };
      }
    }

    // Return top result if above threshold
    if (results[0].score >= threshold) {
      return { entry: results[0].entry, score: results[0].score };
    }
    return null;
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as MemoryRow | undefined;

    if (!row) return undefined;

    // Update access stats
    this.db
      .prepare(
        "UPDATE memories SET accessed_at = datetime('now'), access_count = access_count + 1 WHERE id = ?",
      )
      .run(id);

    return rowToMemoryEntry(row);
  }

  async update(
    id: string,
    updates: Partial<MemoryEntry>,
  ): Promise<MemoryEntry> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Memory entry not found: ${id}`);
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.type !== undefined) {
      sets.push("type = ?");
      params.push(updates.type);
    }
    if (updates.content !== undefined) {
      sets.push("content = ?");
      params.push(updates.content);
    }
    if (updates.importance !== undefined) {
      sets.push("importance = ?");
      params.push(updates.importance);
    }
    if (updates.embedding !== undefined) {
      sets.push("embedding = ?");
      params.push(
        updates.embedding
          ? Buffer.from(new Float64Array(updates.embedding).buffer)
          : null,
      );
    }
    if (updates.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }

    if (sets.length > 0) {
      params.push(id);
      this.db
        .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
        .run(...params);
    }

    // Fetch the updated row
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as MemoryRow;

    return rowToMemoryEntry(row);
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  // ─── Usage stats ─────────────────────────────────────────────

  getUsageStats(): {
    totalIn: number;
    totalOut: number;
    totalCalls: number;
    byModel: Array<{
      model: string;
      totalIn: number;
      totalOut: number;
      callCount: number;
    }>;
  } {
    const rows = this.db
      .prepare(
        `SELECT model,
                COUNT(*) AS call_count,
                COALESCE(SUM(tokens_in), 0) AS total_in,
                COALESCE(SUM(tokens_out), 0) AS total_out
         FROM turns
         WHERE role = 'assistant' AND model IS NOT NULL
         GROUP BY model`,
      )
      .all() as Array<{
      model: string;
      call_count: number;
      total_in: number;
      total_out: number;
    }>;

    let totalIn = 0;
    let totalOut = 0;
    let totalCalls = 0;
    const byModel = rows.map((r) => {
      totalIn += r.total_in;
      totalOut += r.total_out;
      totalCalls += r.call_count;
      return {
        model: r.model,
        totalIn: r.total_in,
        totalOut: r.total_out,
        callCount: r.call_count,
      };
    });

    return { totalIn, totalOut, totalCalls, byModel };
  }

  // ─── Token logs (per-call detail) ─────────────────────────────

  getTokenLogs(
    limit = 50,
    offset = 0,
  ): {
    items: Array<{
      id: string;
      conversationId: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      traceId: string | null;
      createdAt: string;
    }>;
    total: number;
  } {
    const { total } = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM turns WHERE role = 'assistant' AND model IS NOT NULL`,
      )
      .get() as { total: number };

    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, model, tokens_in, tokens_out, trace_id, created_at
         FROM turns
         WHERE role = 'assistant' AND model IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
      id: string;
      conversation_id: string;
      model: string;
      tokens_in: number | null;
      tokens_out: number | null;
      trace_id: string | null;
      created_at: string;
    }>;

    return {
      items: rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        model: r.model,
        tokensIn: r.tokens_in ?? 0,
        tokensOut: r.tokens_out ?? 0,
        traceId: r.trace_id,
        createdAt: r.created_at,
      })),
      total,
    };
  }

  // ─── Conversation turns ────────────────────────────────────────

  async addTurn(conversationId: string, turn: ConversationTurn): Promise<void> {
    // Auto-create conversation if it doesn't exist
    this.ensureConversation(conversationId);

    this.db
      .prepare(
        `INSERT INTO turns (id, conversation_id, role, content, tool_calls, tool_results, model, tokens_in, tokens_out, duration_ms, tool_call_count, trace_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.id || randomUUID(),
        conversationId,
        turn.role,
        turn.content,
        turn.toolCalls ?? null,
        turn.toolResults ?? null,
        turn.model ?? null,
        turn.tokensIn ?? null,
        turn.tokensOut ?? null,
        turn.durationMs ?? null,
        turn.toolCallCount ?? null,
        turn.traceId ?? null,
        turn.createdAt
          ? turn.createdAt.toISOString()
          : new Date().toISOString(),
      );

    // Update conversation's updated_at timestamp
    this.db
      .prepare(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
      )
      .run(conversationId);
  }

  async getHistory(
    conversationId: string,
    limit?: number,
  ): Promise<ConversationTurn[]> {
    const sql = limit
      ? "SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?"
      : "SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at ASC";

    const params: unknown[] = [conversationId];
    if (limit) params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as TurnRow[];

    return rows.map(rowToConversationTurn);
  }

  // ─── Chat Targets (for broadcast persistence) ─────────────────

  saveChatTarget(platform: string, targetId: string, sessionId?: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO chat_targets (platform, target_id, session_id, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      )
      .run(platform, targetId, sessionId ?? null);
  }

  getChatTargets(
    platform: string,
  ): Array<{ targetId: string; sessionId: string | null }> {
    const rows = this.db
      .prepare(
        "SELECT target_id, session_id FROM chat_targets WHERE platform = ?",
      )
      .all(platform) as Array<{ target_id: string; session_id: string | null }>;
    return rows.map((r) => ({
      targetId: r.target_id,
      sessionId: r.session_id,
    }));
  }

  deleteChatTarget(platform: string, targetId: string): void {
    this.db
      .prepare("DELETE FROM chat_targets WHERE platform = ? AND target_id = ?")
      .run(platform, targetId);
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /** Generate embedding for text — uses LLM embed if available, else bag-of-words */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (this.embedFn) {
      try {
        const [embedding] = await this.embedFn([text]);
        return embedding;
      } catch {
        // Fall back to bag-of-words on error
      }
    }
    return this.bow.embed(text);
  }

  // ─── Sessions ────────────────────────────────────────────────

  async saveSession(session: {
    id: string;
    conversationId: string;
    createdAt: Date;
    lastActiveAt: Date;
    title?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, conversation_id, created_at, last_active_at, title, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.conversationId,
        session.createdAt.toISOString(),
        session.lastActiveAt.toISOString(),
        session.title ?? null,
        session.metadata ? JSON.stringify(session.metadata) : null,
      );
  }

  async getSessionById(id: string): Promise<{
    id: string;
    conversationId: string;
    createdAt: Date;
    lastActiveAt: Date;
    title?: string;
    metadata?: Record<string, unknown>;
  } | null> {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as
      | {
          id: string;
          conversation_id: string;
          created_at: string;
          last_active_at: string;
          title: string | null;
          metadata: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.last_active_at),
      title: row.title ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  async listSessions(): Promise<
    Array<{
      id: string;
      conversationId: string;
      createdAt: Date;
      lastActiveAt: Date;
      title?: string;
    }>
  > {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY last_active_at DESC")
      .all() as Array<{
      id: string;
      conversation_id: string;
      created_at: string;
      last_active_at: string;
      title: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      createdAt: new Date(r.created_at),
      lastActiveAt: new Date(r.last_active_at),
      title: r.title ?? undefined,
    }));
  }

  async deleteSession(id: string): Promise<void> {
    const deleteInTransaction = this.db.transaction((sessionId: string) => {
      const row = this.db
        .prepare("SELECT conversation_id FROM sessions WHERE id = ?")
        .get(sessionId) as { conversation_id: string } | undefined;
      if (row) {
        this.db
          .prepare(
            "UPDATE memories SET source_turn_id = NULL WHERE source_turn_id IN (SELECT id FROM turns WHERE conversation_id = ?)",
          )
          .run(row.conversation_id);
        this.db
          .prepare("DELETE FROM turns WHERE conversation_id = ?")
          .run(row.conversation_id);
        this.db
          .prepare("DELETE FROM traces WHERE conversation_id = ?")
          .run(row.conversation_id);
        this.db
          .prepare("DELETE FROM conversations WHERE id = ?")
          .run(row.conversation_id);
      }
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    });
    deleteInTransaction(id);
  }

  // ─── Traces ──────────────────────────────────────────────────

  async addTrace(trace: Trace): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO traces (id, conversation_id, user_input, system_prompt, skill_match, steps, response, model, tokens_in, tokens_out, duration_ms, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trace.id,
        trace.conversationId,
        trace.userInput,
        trace.systemPrompt ?? null,
        trace.skillMatch ?? null,
        JSON.stringify(trace.steps),
        trace.response ?? null,
        trace.model ?? null,
        trace.tokensIn,
        trace.tokensOut,
        trace.durationMs,
        trace.error ?? null,
        trace.createdAt.toISOString(),
      );
  }

  async getTrace(id: string): Promise<Trace | null> {
    const row = this.db.prepare("SELECT * FROM traces WHERE id = ?").get(id) as
      | TraceRow
      | undefined;
    return row ? rowToTrace(row) : null;
  }

  async getTraces(
    limit = 20,
    offset = 0,
  ): Promise<{ items: Trace[]; total: number }> {
    const { total } = this.db
      .prepare("SELECT COUNT(*) AS total FROM traces")
      .get() as { total: number };

    const rows = this.db
      .prepare("SELECT * FROM traces ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as TraceRow[];

    return { items: rows.map(rowToTrace), total };
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private ensureConversation(conversationId: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO conversations (id, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))",
      )
      .run(conversationId);
  }
}

// ─── Row types & mapping ──────────────────────────────────────────

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  source_turn_id: string | null;
  importance: number;
  embedding: Buffer | null;
  created_at: string;
  accessed_at: string;
  access_count: number;
  metadata: string | null;
}

interface TurnRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_results: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  tool_call_count: number | null;
  trace_id: string | null;
  created_at: string;
}

function rowToMemoryEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    type: row.type as MemoryEntry["type"],
    content: row.content,
    sourceTurnId: row.source_turn_id ?? undefined,
    importance: row.importance,
    embedding: row.embedding
      ? Array.from(
          new Float64Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.byteLength / 8,
          ),
        )
      : undefined,
    createdAt: new Date(row.created_at),
    accessedAt: new Date(row.accessed_at),
    accessCount: row.access_count,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : undefined,
  };
}

/**
 * Compute a token-overlap score between two texts.
 * Handles CJK by splitting into individual characters (each is a semantic unit),
 * and Latin/Cyrillic text by splitting on whitespace.
 * Returns a value in [0, 1].
 */
function tokenOverlapScore(query: string, content: string): number {
  const qTokens = tokenizeForOverlap(query);
  const cTokens = tokenizeForOverlap(content);
  if (qTokens.size === 0 || cTokens.size === 0) return 0;

  let overlap = 0;
  for (const t of qTokens) {
    if (cTokens.has(t)) overlap++;
  }

  // Jaccard-like: overlap / querySize (recall-oriented)
  return overlap / qTokens.size;
}

/** Tokenize text into a Set of lowercased tokens. CJK chars become individual tokens. */
function tokenizeForOverlap(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  // Split CJK characters individually, keep Latin/Cyrillic words together
  const parts = lower.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]{2,}/gu,
  );
  if (parts) {
    for (const p of parts) tokens.add(p);
  }
  return tokens;
}

interface TraceRow {
  id: string;
  conversation_id: string;
  user_input: string;
  system_prompt: string | null;
  skill_match: string | null;
  steps: string;
  response: string | null;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  error: string | null;
  created_at: string;
}

function rowToTrace(row: TraceRow): Trace {
  let steps: Trace["steps"] = [];
  try {
    steps = JSON.parse(row.steps);
  } catch {
    // corrupted data — return empty steps
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userInput: row.user_input,
    systemPrompt: row.system_prompt ?? undefined,
    skillMatch: row.skill_match ?? undefined,
    steps,
    response: row.response ?? undefined,
    model: row.model ?? undefined,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    durationMs: row.duration_ms,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

function rowToConversationTurn(row: TurnRow): ConversationTurn {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as ConversationTurn["role"],
    content: row.content,
    toolCalls: row.tool_calls ?? undefined,
    toolResults: row.tool_results ?? undefined,
    model: row.model ?? undefined,
    tokensIn: row.tokens_in ?? undefined,
    tokensOut: row.tokens_out ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    toolCallCount: row.tool_call_count ?? undefined,
    traceId: row.trace_id ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

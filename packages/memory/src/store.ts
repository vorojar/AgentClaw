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
 *   score = bm25Weight × bm25Score
 *         + semanticWeight × vectorScore
 *         + recencyWeight × recencyScore
 *         + importanceWeight × importanceScore
 *
 * BM25 scoring uses FTS5 full-text search. Results are then deduplicated
 * using MMR (Maximal Marginal Relevance) to ensure diversity.
 *
 * When no LLM embed function is provided, falls back to SimpleBagOfWords.
 */
export class SQLiteMemoryStore implements MemoryStore {
  private db: Database.Database;
  private embedFn?: EmbedFn;
  private bow: SimpleBagOfWords;
  private hasFts: boolean;

  constructor(db: Database.Database, embedFn?: EmbedFn) {
    this.db = db;
    this.embedFn = embedFn;
    this.bow = new SimpleBagOfWords(512);
    this.hasFts = this.checkFtsAvailable();
  }

  /** Check whether the memories_fts table exists (old DBs may lack it) */
  private checkFtsAvailable(): boolean {
    try {
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='memories_fts'",
        )
        .get();
      // Also do a lightweight probe to make sure FTS5 module is loaded
      this.db.prepare("SELECT COUNT(*) FROM memories_fts").get();
      return true;
    } catch {
      return false;
    }
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

    // Sync FTS5 index
    if (this.hasFts) {
      this.db
        .prepare("INSERT INTO memories_fts (id, content) VALUES (?, ?)")
        .run(id, entry.content);
    }

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
    // scoring gets a chance to run. The query is used only for embedding-based,
    // token-overlap, and BM25 scoring below.

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const limit = query.limit ?? 20;

    // Fetch more candidates than needed — we re-rank with hybrid scoring
    const fetchLimit = Math.max(limit * 3, 60);

    const rows = this.db
      .prepare(
        `SELECT * FROM memories ${where} ORDER BY importance DESC, accessed_at DESC LIMIT ?`,
      )
      .all(...params, fetchLimit) as MemoryRow[];

    // Hybrid scoring weights (new defaults: bm25=0.2, vector=0.4, recency=0.15, importance=0.25)
    const wBm25 = query.bm25Weight ?? 0.2;
    const wSemantic = query.semanticWeight ?? 0.4;
    const wRecency = query.recencyWeight ?? 0.15;
    const wImportance = query.importanceWeight ?? 0.25;

    // Run BM25 search via FTS5
    const bm25Scores =
      query.query && wBm25 > 0
        ? this.bm25Search(query.query, fetchLimit)
        : new Map<string, number>();

    // Generate query embedding for semantic scoring
    let queryEmbedding: number[] | undefined;
    if (query.query && wSemantic > 0) {
      queryEmbedding = await this.generateEmbedding(query.query);
    }

    const now = Date.now();
    const ONE_DAY_MS = 86_400_000;

    const scored: MemorySearchResult[] = rows.map((row) => {
      const entry = rowToMemoryEntry(row);

      // BM25 score (0-1), 0 if not found in FTS results
      const bm25Score = bm25Scores.get(entry.id) ?? 0;

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
        wBm25 * bm25Score +
        wSemantic * semanticScore +
        wRecency * recencyScore +
        wImportance * importanceScore;

      return { entry, score };
    });

    // Sort by hybrid score
    scored.sort((a, b) => b.score - a.score);

    // Apply MMR dedup to ensure diversity in final results
    return mmrRerank(scored, limit);
  }

  /**
   * Find the most similar existing memory across all types.
   * Returns the entry + score, or null if nothing similar enough exists.
   */
  async findSimilar(
    content: string,
    _type: string,
    threshold = 0.75,
  ): Promise<{ entry: MemoryEntry; score: number } | null> {
    // Search across ALL types — same info stored under different types
    // (e.g. "fact" vs "entity") should still be detected as duplicate
    const results = await this.search({
      query: content,
      limit: 10,
      bm25Weight: 0,
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

    // Sync FTS5 index when content changes
    if (updates.content !== undefined && this.hasFts) {
      this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
      this.db
        .prepare("INSERT INTO memories_fts (id, content) VALUES (?, ?)")
        .run(id, updates.content);
    }

    // Fetch the updated row
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as MemoryRow;

    return rowToMemoryEntry(row);
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    // Sync FTS5 index
    if (this.hasFts) {
      this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
    }
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

  // ─── Reindex ──────────────────────────────────────────────────

  /** Regenerate embeddings for all memories and rebuild FTS index */
  async reindexEmbeddings(): Promise<{ total: number; updated: number }> {
    const rows = this.db
      .prepare("SELECT id, content FROM memories")
      .all() as Array<{ id: string; content: string }>;

    let updated = 0;
    for (const row of rows) {
      const embedding = await this.generateEmbedding(row.content);
      this.db
        .prepare("UPDATE memories SET embedding = ? WHERE id = ?")
        .run(Buffer.from(new Float64Array(embedding).buffer), row.id);
      updated++;
    }

    // Rebuild FTS5 index
    if (this.hasFts) {
      this.db.exec("DELETE FROM memories_fts");
      this.db.exec(
        "INSERT INTO memories_fts (id, content) SELECT id, content FROM memories",
      );
    }

    return { total: rows.length, updated };
  }

  // ─── BM25 / FTS5 helpers ──────────────────────────────────────

  /**
   * Run FTS5 BM25 search and return a map of memory id → normalized score (0-1).
   * Returns an empty map if FTS is unavailable or the query is empty.
   */
  private bm25Search(query: string, limit: number): Map<string, number> {
    const result = new Map<string, number>();
    if (!this.hasFts || !query) return result;

    const escaped = escapeFtsQuery(query);
    if (!escaped) return result;

    try {
      const rows = this.db
        .prepare(
          `SELECT id, bm25(memories_fts) AS rank
           FROM memories_fts
           WHERE content MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(escaped, limit) as Array<{ id: string; rank: number }>;

      if (rows.length === 0) return result;

      // BM25 returns negative scores (lower = better match).
      // Normalize to 0-1 where 1 = best match.
      const ranks = rows.map((r) => r.rank);
      const minRank = Math.min(...ranks); // most negative = best
      const maxRank = Math.max(...ranks); // least negative = worst
      const range = maxRank - minRank;

      for (const row of rows) {
        const normalized = range === 0 ? 1 : (maxRank - row.rank) / range;
        result.set(row.id, normalized);
      }
    } catch {
      // FTS query failed (e.g. syntax error after escaping) — degrade gracefully
    }

    return result;
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

  // ─── Tasks (human & bot shared) ──────────────────────

  addTask(task: {
    id: string;
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    dueDate?: string;
    assignee?: string;
    createdBy?: string;
    sessionId?: string;
    traceId?: string;
    tags?: string[];
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, status, priority, due_date, assignee, created_by, session_id, trace_id, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.description ?? "",
        task.status ?? "todo",
        task.priority ?? "medium",
        task.dueDate ?? null,
        task.assignee ?? "human",
        task.createdBy ?? "human",
        task.sessionId ?? null,
        task.traceId ?? null,
        JSON.stringify(task.tags ?? []),
        now,
        now,
      );
  }

  updateTask(
    id: string,
    updates: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      dueDate?: string | null;
      assignee?: string;
      tags?: string[];
    },
  ): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      sets.push("title = ?");
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      params.push(updates.description);
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.priority !== undefined) {
      sets.push("priority = ?");
      params.push(updates.priority);
    }
    if (updates.dueDate !== undefined) {
      sets.push("due_date = ?");
      params.push(updates.dueDate);
    }
    if (updates.assignee !== undefined) {
      sets.push("assignee = ?");
      params.push(updates.assignee);
    }
    if (updates.tags !== undefined) {
      sets.push("tags = ?");
      params.push(JSON.stringify(updates.tags));
    }

    if (sets.length === 0) return false;

    sets.push("updated_at = datetime('now')");
    params.push(id);

    const result = this.db
      .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  deleteTask(id: string): boolean {
    const result = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return result.changes > 0;
  }

  listTasks(
    filters?: { status?: string; priority?: string },
    limit = 100,
    offset = 0,
  ): { items: TaskRow[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.priority) {
      conditions.push("priority = ?");
      params.push(filters.priority);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM tasks ${where}`)
      .get(...params) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM tasks ${where} ORDER BY
           CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
           updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as TaskRow[];

    return { items: rows, total };
  }

  getCalendarItems(
    year: number,
    month: number,
  ): Array<{
    date: string;
    type: "task" | "schedule";
    id: string;
    title: string;
    status?: string;
    priority?: string;
  }> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

    const tasks = this.db
      .prepare(
        `SELECT id, title, due_date, status, priority FROM tasks
         WHERE due_date >= ? AND due_date < ?
         ORDER BY due_date`,
      )
      .all(startDate, endDate) as Array<{
      id: string;
      title: string;
      due_date: string;
      status: string;
      priority: string;
    }>;

    return tasks.map((t) => ({
      date: t.due_date,
      type: "task" as const,
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    }));
  }

  // ─── SubAgents (persistent records) ─────────────────

  addSubAgent(agent: {
    id: string;
    sessionId?: string;
    goal: string;
    model?: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO subagents (id, session_id, goal, model, status, created_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(
        agent.id,
        agent.sessionId ?? null,
        agent.goal,
        agent.model ?? null,
        now,
      );
  }

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
  ): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.result !== undefined) {
      sets.push("result = ?");
      params.push(updates.result);
    }
    if (updates.error !== undefined) {
      sets.push("error = ?");
      params.push(updates.error);
    }
    if (updates.tokensIn !== undefined) {
      sets.push("tokens_in = ?");
      params.push(updates.tokensIn);
    }
    if (updates.tokensOut !== undefined) {
      sets.push("tokens_out = ?");
      params.push(updates.tokensOut);
    }
    if (updates.toolsUsed !== undefined) {
      sets.push("tools_used = ?");
      params.push(JSON.stringify(updates.toolsUsed));
    }
    if (updates.iterations !== undefined) {
      sets.push("iterations = ?");
      params.push(updates.iterations);
    }
    if (updates.completedAt !== undefined) {
      sets.push("completed_at = ?");
      params.push(updates.completedAt);
    }

    if (sets.length === 0) return false;

    params.push(id);
    const result = this.db
      .prepare(`UPDATE subagents SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  listSubAgents(
    filters?: { sessionId?: string; status?: string },
    limit = 20,
    offset = 0,
  ): { items: SubAgentRow[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.sessionId) {
      conditions.push("session_id = ?");
      params.push(filters.sessionId);
    }
    if (filters?.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM subagents ${where}`)
      .get(...params) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM subagents ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as SubAgentRow[];

    return { items: rows, total };
  }

  getSubAgent(id: string): SubAgentRow | null {
    const row = this.db
      .prepare("SELECT * FROM subagents WHERE id = ?")
      .get(id) as SubAgentRow | undefined;
    return row ?? null;
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

/**
 * Escape a user query for FTS5 MATCH syntax.
 * Wraps each token in double quotes to prevent syntax errors from special chars.
 * Returns null if the query has no usable tokens.
 */
function escapeFtsQuery(query: string): string | null {
  // Extract tokens: CJK characters individually, Latin/Cyrillic words (2+ chars)
  const tokens = query.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]{2,}/gu,
  );
  if (!tokens || tokens.length === 0) return null;

  // Quote each token and join with OR for broad matching
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/**
 * MMR (Maximal Marginal Relevance) reranking for result diversity.
 *
 * Iteratively selects results that balance relevance (score) with diversity
 * (dissimilarity to already-selected entries). This prevents returning
 * multiple near-duplicate memories.
 *
 * @param results - Scored results sorted by relevance (descending)
 * @param limit - Maximum number of results to return
 * @param lambda - Balance factor: 1.0 = pure relevance, 0.0 = pure diversity
 */
function mmrRerank(
  results: MemorySearchResult[],
  limit: number,
  lambda = 0.7,
): MemorySearchResult[] {
  if (results.length <= 1 || limit <= 0) return results.slice(0, limit);

  const selected: MemorySearchResult[] = [];
  const remaining = new Set(results.map((_, i) => i));

  // Start with the highest-scored result
  selected.push(results[0]);
  remaining.delete(0);

  while (selected.length < limit && remaining.size > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (const idx of remaining) {
      const candidate = results[idx];

      // Find max similarity to any already-selected entry
      let maxSim = 0;
      for (const sel of selected) {
        const sim = tokenOverlapScore(
          candidate.entry.content,
          sel.entry.content,
        );
        if (sim > maxSim) maxSim = sim;
      }

      // MMR score: balance relevance vs diversity
      const mmrScore = lambda * candidate.score - (1 - lambda) * maxSim;

      if (mmrScore > bestMmr) {
        bestMmr = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) break;

    selected.push(results[bestIdx]);
    remaining.delete(bestIdx);
  }

  return selected;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string;
  created_by: string;
  session_id: string | null;
  trace_id: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface SubAgentRow {
  id: string;
  session_id: string | null;
  goal: string;
  model: string | null;
  status: string;
  result: string | null;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
  tools_used: string;
  iterations: number;
  created_at: string;
  completed_at: string | null;
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

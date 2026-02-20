import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  MemoryStore,
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  ConversationTurn,
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

    // Text filter (still used as a pre-filter for LIKE match)
    if (query.query) {
      conditions.push("content LIKE ?");
      params.push(`%${query.query}%`);
    }

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
        // Fallback: simple text overlap score
        const q = query.query.toLowerCase();
        const c = entry.content.toLowerCase();
        semanticScore = c.includes(q) ? 0.6 : 0;
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

  // ─── Conversation turns ────────────────────────────────────────

  async addTurn(conversationId: string, turn: ConversationTurn): Promise<void> {
    // Auto-create conversation if it doesn't exist
    this.ensureConversation(conversationId);

    this.db
      .prepare(
        `INSERT INTO turns (id, conversation_id, role, content, tool_calls, tool_results, model, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  private ensureConversation(conversationId: string): void {
    const exists = this.db
      .prepare("SELECT 1 FROM conversations WHERE id = ?")
      .get(conversationId);

    if (!exists) {
      this.db
        .prepare(
          "INSERT INTO conversations (id, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))",
        )
        .run(conversationId);
    }
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
    createdAt: new Date(row.created_at),
  };
}

import { createDatabase, type DbAdapter } from "./db-adapter.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_results TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  tool_call_count INTEGER,
  trace_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_turns_conversation ON turns(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('identity', 'fact', 'preference', 'entity', 'episodic')),
  content TEXT NOT NULL,
  source_turn_id TEXT REFERENCES turns(id),
  importance REAL NOT NULL DEFAULT 0.5,
  embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  color TEXT DEFAULT '#6B7F5E',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS chat_targets (
  platform TEXT NOT NULL,
  target_id TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (platform, target_id)
);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_input TEXT NOT NULL,
  system_prompt TEXT,
  skill_match TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  response TEXT,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_traces_created ON traces(created_at DESC);

-- Task management (human & bot shared)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('inbox', 'todo', 'in_progress', 'triaged', 'queued', 'running', 'done', 'failed', 'blocked', 'waiting_decision')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'medium', 'low')),
  due_date TEXT,
  assignee TEXT NOT NULL DEFAULT 'human',
  created_by TEXT NOT NULL DEFAULT 'human',
  session_id TEXT,
  trace_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

-- Sub-agent execution records (real-time + historical)
CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  goal TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'killed')),
  result TEXT,
  error TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tools_used TEXT NOT NULL DEFAULT '[]',
  iterations INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subagents_session ON subagents(session_id);
CREATE INDEX IF NOT EXISTS idx_subagents_created ON subagents(created_at DESC);

-- Agent profiles (persona with custom soul, model, tools)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  soul TEXT NOT NULL DEFAULT '',
  model TEXT,
  tools TEXT,
  max_iterations INTEGER,
  temperature REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Key-value settings store
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scheduled tasks (cron automations, persisted across restarts)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  action TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  one_shot INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 full-text search index for hybrid memory retrieval (BM25 + vector)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  content,
  tokenize='unicode61'
);
`;

/**
 * Initialize (or open) a SQLite database at the given path
 * and ensure all required tables exist.
 */
export function initDatabase(dbPath: string): DbAdapter {
  // createDatabase 内部已执行 WAL + foreign_keys PRAGMA
  const db = createDatabase(dbPath);

  // Execute schema creation
  db.exec(SCHEMA_SQL);

  // Migrations: add columns to existing tables
  addColumnIfMissing(db, "turns", "trace_id", "TEXT");
  addColumnIfMissing(db, "turns", "duration_ms", "INTEGER");
  addColumnIfMissing(db, "turns", "tool_call_count", "INTEGER");
  addColumnIfMissing(db, "sessions", "title", "TEXT");
  addColumnIfMissing(
    db,
    "sessions",
    "project_id",
    "TEXT REFERENCES projects(id) ON DELETE SET NULL",
  );

  // Create index after migration ensures column exists
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, last_active_at DESC)",
    );
  } catch {
    // Index may already exist
  }

  // Migration: rebuild tasks table to update CHECK constraint for new statuses
  rebuildTasksTableIfNeeded(db);

  // Task Manager v2 migrations: extend tasks table for execution engine
  addColumnIfMissing(db, "tasks", "executor", "TEXT DEFAULT 'human'");
  addColumnIfMissing(db, "tasks", "source", "TEXT DEFAULT 'web'");
  addColumnIfMissing(db, "tasks", "source_msg_id", "TEXT");
  addColumnIfMissing(db, "tasks", "scheduled_at", "TEXT");
  addColumnIfMissing(db, "tasks", "deadline", "TEXT");
  addColumnIfMissing(db, "tasks", "recurrence", "TEXT");
  addColumnIfMissing(db, "tasks", "parent_id", "TEXT");
  addColumnIfMissing(db, "tasks", "result", "TEXT");
  addColumnIfMissing(db, "tasks", "decision_context", "TEXT");
  addColumnIfMissing(db, "tasks", "decision_options", "TEXT");
  addColumnIfMissing(db, "tasks", "decision_result", "TEXT");
  addColumnIfMissing(db, "tasks", "trace_ids", "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, "tasks", "progress", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "tasks", "completed_at", "TEXT");
  addColumnIfMissing(db, "tasks", "metadata", "TEXT");

  // Traces: add channel column
  addColumnIfMissing(db, "traces", "channel", "TEXT");
  // Traces: add prompt cache token columns
  addColumnIfMissing(
    db,
    "traces",
    "cache_creation_tokens",
    "INTEGER DEFAULT 0",
  );
  addColumnIfMissing(db, "traces", "cache_read_tokens", "INTEGER DEFAULT 0");

  // Create indexes for migration-added columns (must run after addColumnIfMissing)
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_executor ON tasks(executor);
      CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
    `);
  } catch {
    // Indexes may already exist
  }

  // Migration: rebuild memories table if CHECK constraint doesn't include 'identity'
  rebuildMemoriesTableIfNeeded(db);

  // Migration: populate FTS5 index from existing memories (one-time sync)
  const ftsCount = countRows(db, "memories_fts");
  const memCount = countRows(db, "memories");
  if (ftsCount === 0 && memCount > 0) {
    db.exec(
      "INSERT INTO memories_fts (id, content) SELECT id, content FROM memories",
    );
  }

  return db;
}

/**
 * Rebuild memories table if CHECK constraint doesn't include 'identity'.
 * SQLite does not support ALTER CHECK, so we recreate the table.
 */
function rebuildMemoriesTableIfNeeded(db: DbAdapter): void {
  try {
    db.exec(
      "INSERT INTO memories (id, type, content, importance) VALUES ('__check_probe__', 'identity', '__probe__', 0)",
    );
    db.exec("DELETE FROM memories WHERE id = '__check_probe__'");
  } catch {
    // CHECK constraint failed → rebuild without CHECK on type
    db.exec(`
      CREATE TABLE memories_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_turn_id TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        embedding BLOB,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT
      );
      INSERT INTO memories_new SELECT id, type, content, source_turn_id, importance, embedding, created_at, accessed_at, access_count, metadata FROM memories;
      DROP TABLE memories;
      ALTER TABLE memories_new RENAME TO memories;
    `);
  }
}

/**
 * Rebuild tasks table if CHECK constraint is outdated.
 * SQLite does not support ALTER CHECK, so we recreate the table.
 * The rebuilt table drops CHECK constraints entirely to avoid future migration pain.
 */
function rebuildTasksTableIfNeeded(db: DbAdapter): void {
  // Probe with 'triaged' status — if CHECK rejects it, we need to rebuild
  try {
    db.exec(
      "INSERT INTO tasks (id, title, status) VALUES ('__check_probe__', '__probe__', 'triaged')",
    );
    // If it succeeded, constraint already allows new statuses — remove probe row
    db.exec("DELETE FROM tasks WHERE id = '__check_probe__'");
  } catch {
    // CHECK constraint failed → need to rebuild without CHECK constraints
    db.exec(`
      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'normal',
        due_date TEXT,
        assignee TEXT NOT NULL DEFAULT 'human',
        created_by TEXT NOT NULL DEFAULT 'human',
        session_id TEXT,
        trace_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO tasks_new SELECT id, title, description, status, priority, due_date, assignee, created_by, session_id, trace_id, tags, created_at, updated_at FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
    `);
  }
}

/** Count rows in a table */
function countRows(db: DbAdapter, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get() as { cnt: number }
  ).cnt;
}

/** Add a column to a table if it doesn't already exist */
function addColumnIfMissing(
  db: DbAdapter,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

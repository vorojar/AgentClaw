import Database from "better-sqlite3";

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
  type TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'entity', 'episodic')),
  content TEXT NOT NULL,
  source_turn_id TEXT REFERENCES turns(id),
  importance REAL NOT NULL DEFAULT 0.5,
  embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
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
  duration_ms INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_traces_created ON traces(created_at DESC);
`;

/**
 * Initialize (or open) a SQLite database at the given path
 * and ensure all required tables exist.
 */
export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Execute schema creation
  db.exec(SCHEMA_SQL);

  // Migrations: add columns to existing tables
  const turnCols = db.prepare("PRAGMA table_info(turns)").all() as Array<{
    name: string;
  }>;
  if (!turnCols.some((c) => c.name === "trace_id")) {
    db.exec("ALTER TABLE turns ADD COLUMN trace_id TEXT");
  }
  if (!turnCols.some((c) => c.name === "duration_ms")) {
    db.exec("ALTER TABLE turns ADD COLUMN duration_ms INTEGER");
  }
  if (!turnCols.some((c) => c.name === "tool_call_count")) {
    db.exec("ALTER TABLE turns ADD COLUMN tool_call_count INTEGER");
  }

  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
  }>;
  if (!sessionCols.some((c) => c.name === "title")) {
    db.exec("ALTER TABLE sessions ADD COLUMN title TEXT");
  }

  return db;
}

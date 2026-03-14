// @agentclaw/memory — Memory system (SQLite-backed)

export { initDatabase } from "./database.js";
export { createDatabase } from "./db-adapter.js";
export type { DbAdapter, DbStatement } from "./db-adapter.js";
export { SQLiteMemoryStore } from "./store.js";
export type { EmbedFn } from "./store.js";
export { cosineSimilarity, SimpleBagOfWords } from "./embeddings.js";

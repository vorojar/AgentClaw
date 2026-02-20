// @agentclaw/memory — Memory system (SQLite-backed)

export { initDatabase } from "./database.js";
export { SQLiteMemoryStore } from "./store.js";
export type { EmbedFn } from "./store.js";
export { cosineSimilarity, SimpleBagOfWords } from "./embeddings.js";

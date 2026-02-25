import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Skill,
  SkillMatch,
  SkillRegistry,
  SkillTrigger,
} from "@agentclaw/types";
import { parseSkillFile } from "./parser.js";

/**
 * Default implementation of the SkillRegistry interface.
 *
 * Manages a collection of skills loaded from SKILL.md files and provides
 * pattern-based matching against user input.
 */
/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class SkillRegistryImpl implements SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private settingsPath: string | null = null;
  private embedFn: ((texts: string[]) => Promise<number[][]>) | null = null;
  private skillEmbeddings: Map<string, number[]> = new Map();

  /**
   * Set the path for persisting skill enabled/disabled settings.
   * Must be called before loadFromDirectory so settings are applied after loading.
   */
  setSettingsPath(filePath: string): void {
    this.settingsPath = filePath;
  }

  /**
   * Set the embedding function for semantic skill matching.
   * Immediately computes embeddings for all loaded skills.
   */
  setEmbedFn(fn: (texts: string[]) => Promise<number[][]>): void {
    this.embedFn = fn;
    this.computeEmbeddings().catch((err) => {
      console.warn(`[skills] Failed to compute embeddings: ${err}`);
    });
  }

  /**
   * Batch-compute embedding vectors for all enabled skills.
   * Each skill is represented as "name: description".
   */
  private async computeEmbeddings(): Promise<void> {
    if (!this.embedFn) return;
    const entries: { id: string; text: string }[] = [];
    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;
      entries.push({ id: skill.id, text: `${skill.name}: ${skill.description}` });
    }
    if (entries.length === 0) return;
    try {
      const vectors = await this.embedFn(entries.map((e) => e.text));
      this.skillEmbeddings.clear();
      for (let i = 0; i < entries.length; i++) {
        this.skillEmbeddings.set(entries[i].id, vectors[i]);
      }
      console.log(`[skills] Computed embeddings for ${entries.length} skills`);
    } catch (err) {
      console.warn(`[skills] Embedding computation failed: ${err}`);
    }
  }

  /**
   * Load persisted skill enabled/disabled settings from the JSON file.
   * Called automatically at the end of loadFromDirectory.
   */
  private async loadSettings(): Promise<void> {
    if (!this.settingsPath) return;
    try {
      const content = await readFile(this.settingsPath, "utf-8");
      const settings = JSON.parse(content) as Record<string, boolean>;
      for (const [id, enabled] of Object.entries(settings)) {
        const skill = this.skills.get(id);
        if (skill) skill.enabled = enabled;
      }
    } catch {
      // File doesn't exist yet — use defaults (all enabled)
    }
  }

  /**
   * Persist skill enabled/disabled settings to the JSON file.
   * Only saves disabled skills (enabled is the default).
   */
  private saveSettings(): void {
    if (!this.settingsPath) return;
    const settings: Record<string, boolean> = {};
    for (const [id, skill] of this.skills) {
      if (!skill.enabled) settings[id] = false;
    }
    try {
      mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
    } catch (err) {
      console.warn(`[skills] Failed to save settings: ${err}`);
    }
  }

  /**
   * Load all skills from a directory.
   *
   * Expects each skill to live in its own subdirectory with a SKILL.md file:
   *   dirPath/
   *     coding/SKILL.md
   *     research/SKILL.md
   *     writing/SKILL.md
   *
   * After initial loading, starts watching the directory for changes so that
   * new, modified, or deleted skill files are automatically picked up.
   */
  async loadFromDirectory(dirPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or is not readable — silently skip
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFilePath = path.join(dirPath, entry.name, "SKILL.md");
      await this.loadSkillFile(skillFilePath);
    }

    // Apply persisted enabled/disabled settings after all skills are loaded
    await this.loadSettings();

    this.watchDirectory(dirPath);
  }

  /**
   * Load (or reload) a single skill file into the registry.
   *
   * If the file exists and is valid, the skill is registered (upserted).
   * If the file does not exist (deleted), the corresponding skill is removed.
   *
   * @returns true if the skill was loaded/removed successfully
   */
  private async loadSkillFile(filePath: string): Promise<boolean> {
    if (!existsSync(filePath)) {
      // File was deleted — remove the skill whose path matches
      for (const [id, skill] of this.skills) {
        if (skill.path === filePath) {
          this.skills.delete(id);
          return true;
        }
      }
      return false;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const skill = parseSkillFile(filePath, content);
      this.register(skill);
      // Recompute embedding for the changed skill
      if (this.embedFn && skill.enabled) {
        this.embedFn([`${skill.name}: ${skill.description}`])
          .then((vectors) => {
            this.skillEmbeddings.set(skill.id, vectors[0]);
          })
          .catch(() => {});
      }
      return true;
    } catch {
      // Skip skills that can't be parsed
      return false;
    }
  }

  /**
   * Watch a skills directory for file changes and automatically reload
   * skills when their SKILL.md files are added, modified, or deleted.
   *
   * Uses `fs.watch` with recursive mode and a 300ms debounce to handle
   * duplicate events that some platforms emit.
   */
  private watchDirectory(dir: string): void {
    try {
      this.watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
        // filename may be null on some platforms
        if (!filename) return;

        // Normalize path separators (Windows may use backslashes)
        const normalized = filename.replace(/\\/g, "/");

        // Only react to .md files
        if (!normalized.endsWith(".md")) return;

        const fullPath = path.resolve(dir, filename);

        // Debounce: clear any pending timer for this file
        const existing = this.debounceTimers.get(fullPath);
        if (existing) {
          clearTimeout(existing);
        }

        this.debounceTimers.set(
          fullPath,
          setTimeout(async () => {
            this.debounceTimers.delete(fullPath);

            const loaded = await this.loadSkillFile(fullPath);
            if (loaded) {
              console.log(`[skills] Reloaded: ${filename}`);
            }
          }, 300),
        );
      });

      // Don't let the watcher prevent the process from exiting
      this.watcher.unref();

      console.log(`[skills] Watching ${dir} for changes`);
    } catch (err) {
      console.warn(`[skills] Failed to watch directory: ${err}`);
    }
  }

  /**
   * Register a skill in the registry.
   * If a skill with the same ID already exists, it will be overwritten.
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  /**
   * Find skills that match the given user input.
   *
   * Matching strategy (per skill):
   * 1. If the skill has keyword triggers and any keyword matches → use legacy logic (backward compat)
   * 2. Otherwise compute a token-overlap score against name + description
   *    → score > 0.15 is considered a match
   *
   * Results are sorted by confidence in descending order.
   */
  async match(input: string): Promise<SkillMatch[]> {
    const matches: SkillMatch[] = [];
    const inputLower = input.toLowerCase();

    // Check legacy keyword triggers first (always takes priority)
    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;
      if (skill.triggers && skill.triggers.length > 0) {
        let bestScore: number | null = null;
        let bestTrigger = skill.triggers[0];
        for (const trigger of skill.triggers) {
          const score = this.matchTrigger(trigger, inputLower);
          if (score !== null && (bestScore === null || score > bestScore)) {
            bestScore = score;
            bestTrigger = trigger;
          }
        }
        if (bestScore !== null) {
          matches.push({
            skill,
            confidence: bestScore,
            matchedTrigger: bestTrigger,
          });
        }
      }
    }

    // Embedding-based matching (preferred) or token-overlap fallback
    if (this.embedFn && this.skillEmbeddings.size > 0) {
      try {
        const [queryVec] = await this.embedFn([input]);
        for (const skill of this.skills.values()) {
          if (!skill.enabled) continue;
          // Skip skills already matched by keyword triggers
          if (matches.some((m) => m.skill.id === skill.id)) continue;
          const cached = this.skillEmbeddings.get(skill.id);
          if (!cached) continue;
          const score = cosineSimilarity(queryVec, cached);
          if (score > 0.45) {
            matches.push({ skill, confidence: score });
          }
        }
      } catch {
        // Embedding failed — fall through to token-overlap
        for (const skill of this.skills.values()) {
          if (!skill.enabled) continue;
          if (matches.some((m) => m.skill.id === skill.id)) continue;
          const score = descriptionScore(inputLower, skill);
          if (score > 0.15) {
            matches.push({ skill, confidence: score });
          }
        }
      }
    } else {
      // No embedFn — use token-overlap
      for (const skill of this.skills.values()) {
        if (!skill.enabled) continue;
        if (matches.some((m) => m.skill.id === skill.id)) continue;
        const score = descriptionScore(inputLower, skill);
        if (score > 0.15) {
          matches.push({ skill, confidence: score });
        }
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);

    return matches;
  }

  /**
   * Get a skill by its ID.
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * List all registered skills.
   */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Enable or disable a skill, and persist the change.
   */
  setEnabled(id: string, enabled: boolean): void {
    const skill = this.skills.get(id);
    if (skill) {
      skill.enabled = enabled;
      this.saveSettings();
    }
  }

  /**
   * Match a single trigger against the input.
   * Returns the confidence score if matched, or null if no match.
   */
  private matchTrigger(
    trigger: SkillTrigger,
    inputLower: string,
  ): number | null {
    switch (trigger.type) {
      case "keyword": {
        if (trigger.patterns.length === 0) return null;

        let matchedCount = 0;
        for (const pattern of trigger.patterns) {
          if (inputLower.includes(pattern.toLowerCase())) {
            matchedCount++;
          }
        }

        if (matchedCount === 0) return null;

        // Any single keyword match gives at least 0.5 confidence.
        // Multiple matches increase it further (max 1.0).
        const ratio = matchedCount / trigger.patterns.length;
        return Math.max(0.5, ratio * 0.8 + 0.2);
      }

      case "always":
        return 0.1;

      case "intent":
        // Intent-based matching would require NLP; for now, fall back to
        // keyword-style matching with the given patterns.
        if (trigger.patterns.length === 0) return null;

        for (const pattern of trigger.patterns) {
          if (inputLower.includes(pattern.toLowerCase())) {
            return trigger.confidence ?? 0.5;
          }
        }
        return null;

      default:
        return null;
    }
  }
}

/**
 * Tokenize text for matching. Uses CJK bigrams (2-char sliding window)
 * to avoid false matches on single generic characters like "截" or "图".
 * Latin words are kept as whole tokens (2+ chars).
 */
function tokenizeForMatch(text: string): Set<string> {
  const tokens = new Set<string>();
  // Latin words (2+ chars)
  for (const m of text.matchAll(/[a-z]{2,}/g)) {
    tokens.add(m[0]);
  }
  // CJK bigrams: extract contiguous CJK runs, then slide a 2-char window
  for (const m of text.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      tokens.add(run); // single CJK char has no bigram, keep as-is
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.add(run[i] + run[i + 1]);
      }
    }
  }
  return tokens;
}

/**
 * Compute a token-overlap score between user input and a skill's
 * name + description. Returns a value between 0 and 1.
 */
function descriptionScore(inputLower: string, skill: Skill): number {
  const corpus = `${skill.name} ${skill.description}`.toLowerCase();
  const inputTokens = tokenizeForMatch(inputLower);
  const corpusTokens = tokenizeForMatch(corpus);
  if (inputTokens.size === 0 || corpusTokens.size === 0) return 0;

  let hits = 0;
  for (const t of inputTokens) {
    if (corpusTokens.has(t)) hits++;
  }
  // Normalize by the smaller set to avoid penalizing short inputs
  return hits / Math.min(inputTokens.size, corpusTokens.size);
}

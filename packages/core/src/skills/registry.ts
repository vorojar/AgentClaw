import { existsSync } from "node:fs";
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
export class SkillRegistryImpl implements SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

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
   * Matching rules:
   * - keyword trigger: case-insensitive substring match of patterns against input
   *   confidence = matchedCount / totalPatterns * 0.8 + 0.2
   * - always trigger: always matches with confidence 0.1
   *
   * Results are sorted by confidence in descending order.
   */
  async match(input: string): Promise<SkillMatch[]> {
    const matches: SkillMatch[] = [];
    const inputLower = input.toLowerCase();

    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;

      for (const trigger of skill.triggers) {
        const matchResult = this.matchTrigger(trigger, inputLower);
        if (matchResult !== null) {
          matches.push({
            skill,
            confidence: matchResult,
            matchedTrigger: trigger,
          });
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
   * Enable or disable a skill.
   */
  setEnabled(id: string, enabled: boolean): void {
    const skill = this.skills.get(id);
    if (skill) {
      skill.enabled = enabled;
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

        // confidence = matchedCount / totalPatterns * 0.8 + 0.2
        return (matchedCount / trigger.patterns.length) * 0.8 + 0.2;
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

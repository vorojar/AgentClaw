import { readdir, readFile } from "fs/promises";
import path from "path";
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

  /**
   * Load all skills from a directory.
   *
   * Expects each skill to live in its own subdirectory with a SKILL.md file:
   *   dirPath/
   *     coding/SKILL.md
   *     research/SKILL.md
   *     writing/SKILL.md
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

      try {
        const content = await readFile(skillFilePath, "utf-8");
        const skill = parseSkillFile(skillFilePath, content);
        this.register(skill);
      } catch {
        // Skip skills that can't be parsed
        continue;
      }
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

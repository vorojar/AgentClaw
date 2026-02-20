import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool, ToolResult } from "@agentclaw/types";

const SKILLS_DIR = resolve(process.cwd(), process.env.SKILLS_DIR || "./skills");

/**
 * Convert a name to a safe directory name (kebab-case).
 */
function toDirectoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build a SKILL.md file content from the given parameters.
 */
function buildSkillMd(params: {
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
}): string {
  const patternsJson = JSON.stringify(params.triggers);

  return `---
name: ${params.name}
description: ${params.description}
triggers:
  - type: keyword
    patterns: ${patternsJson}
---

${params.instructions.trim()}
`;
}

export const createSkillTool: Tool = {
  name: "create_skill",
  description:
    "Create a new reusable skill that will be automatically loaded. " +
    "Use this to save successful workflows as recipes for future reuse. " +
    "The skill's instructions guide the AI on how to handle matching requests.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Skill name, short and descriptive (e.g. 'video-compress', 'daily-news')",
      },
      description: {
        type: "string",
        description: "Brief description of what this skill does",
      },
      triggers: {
        type: "array",
        description:
          "Keywords that activate this skill (e.g. ['压缩视频', 'video compress', '视频太大'])",
        items: { type: "string" },
      },
      instructions: {
        type: "string",
        description:
          "Detailed instructions for the AI when this skill is activated. " +
          "Include specific tool calls, commands, parameters, and step-by-step recipes. " +
          "The more specific, the faster and cheaper execution will be.",
      },
    },
    required: ["name", "description", "triggers", "instructions"],
  },

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const name = input.name as string;
    const description = input.description as string;
    const triggers = input.triggers as string[];
    const instructions = input.instructions as string;

    if (!name || !description || !triggers?.length || !instructions) {
      return {
        content:
          "Missing required parameters: name, description, triggers, instructions",
        isError: true,
      };
    }

    const dirName = toDirectoryName(name);
    if (!dirName) {
      return { content: `Invalid skill name: "${name}"`, isError: true };
    }

    const skillDir = resolve(SKILLS_DIR, dirName);
    const skillFile = resolve(skillDir, "SKILL.md");

    try {
      mkdirSync(skillDir, { recursive: true });
    } catch {
      // may already exist
    }

    const content = buildSkillMd({ name, description, triggers, instructions });

    try {
      writeFileSync(skillFile, content, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Failed to write skill file: ${message}`,
        isError: true,
      };
    }

    return {
      content: `Skill "${name}" created at ${skillFile}. It will be auto-loaded and available for future requests matching: ${triggers.join(", ")}`,
      isError: false,
    };
  },
};

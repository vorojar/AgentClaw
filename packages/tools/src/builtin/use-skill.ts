import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const useSkillTool: Tool = {
  name: "use_skill",
  description:
    "Load a skill's detailed instructions by name. Call this BEFORE executing a skill-related task so you know the exact commands and rules.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The skill name from the Available Skills list",
      },
    },
    required: ["name"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const name = String(input.name ?? "").trim();
    if (!name) {
      return { content: "Error: skill name is required", isError: true };
    }

    const registry = context?.skillRegistry;
    if (!registry) {
      return { content: "Error: skill registry not available", isError: true };
    }

    const skill = registry.get(name);
    if (!skill) {
      const available = registry
        .list()
        .filter((s) => s.enabled)
        .map((s) => s.name)
        .join(", ");
      return {
        content: `Skill "${name}" not found. Available: ${available}`,
        isError: true,
      };
    }

    return { content: skill.instructions };
  },
};

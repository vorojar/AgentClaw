import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const rememberTool: Tool = {
  name: "remember",
  description: "Save information to long-term memory for future recall.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string" },
      type: {
        type: "string",
        enum: ["fact", "preference", "entity", "episodic"],
        default: "fact",
      },
    },
    required: ["content"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const content = input.content as string;
    const type = (input.type as string) || "fact";

    if (!context?.saveMemory) {
      return {
        content: "Memory system is not available in this context.",
        isError: true,
      };
    }

    try {
      await context.saveMemory(
        content,
        type as "fact" | "preference" | "entity" | "episodic",
      );
      return {
        content: `Remembered: ${content}`,
        isError: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Failed to save memory: ${message}`,
        isError: true,
      };
    }
  },
};

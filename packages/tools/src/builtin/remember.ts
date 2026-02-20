import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const rememberTool: Tool = {
  name: "remember",
  description:
    "Save important information to long-term memory so you can recall it in future conversations. Use this when the user asks you to remember something, or when you learn important facts about the user.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description:
          "The information to remember, written as a clear factual statement (e.g. 'User\\'s name is Alice', 'Bot\\'s name is 爬爬虾')",
      },
      type: {
        type: "string",
        description: "Category of the memory",
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

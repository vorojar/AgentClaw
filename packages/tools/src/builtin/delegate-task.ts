import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const delegateTaskTool: Tool = {
  name: "delegate_task",
  description:
    "Spawn an independent sub-agent to handle a subtask. The sub-agent has its own context and tools. Use for tasks that can run in isolation (research, computation, file generation). Returns the sub-agent's final response.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Clear instruction for the sub-agent to execute.",
      },
    },
    required: ["task"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const task = input.task as string;

    if (!context?.delegateTask) {
      return {
        content: "delegate_task is not available in this context.",
        isError: true,
      };
    }

    try {
      const result = await context.delegateTask(task);
      return { content: result, isError: false };
    } catch (err) {
      return {
        content: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

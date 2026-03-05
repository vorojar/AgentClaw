import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const subagentTool: Tool = {
  name: "subagent",
  category: "builtin",
  description:
    "Spawn and manage sub-agents for parallel task processing. " +
    "Sub-agents have independent conversations and can run concurrently. " +
    "Actions: spawn (create), result (poll/get result), kill (terminate), list (show all).",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Action to perform: spawn | result | kill | list",
        enum: ["spawn", "result", "kill", "list"],
      },
      goal: {
        type: "string",
        description: "Task description for the sub-agent (required for spawn)",
      },
      id: {
        type: "string",
        description: "Sub-agent ID (required for result/kill)",
      },
      maxIterations: {
        type: "number",
        description:
          "Max iterations for the sub-agent (default: 8, only for spawn)",
      },
      model: {
        type: "string",
        description: "Override model name (only for spawn)",
      },
    },
    required: ["action"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const manager = context?.subAgentManager;
    if (!manager) {
      return {
        content: "Sub-agent manager is not available in this context.",
        isError: true,
      };
    }

    const action = input.action as string;

    switch (action) {
      case "spawn": {
        const goal = input.goal as string;
        if (!goal) {
          return { content: "Missing required parameter: goal", isError: true };
        }
        const id = manager.spawn(goal, {
          maxIterations: (input.maxIterations as number) ?? undefined,
          model: (input.model as string) ?? undefined,
        });
        return {
          content: `Sub-agent spawned with ID: ${id}\nGoal: ${goal}\nUse action "result" with this ID to check progress.`,
          isError: false,
          metadata: { subagentId: id },
        };
      }

      case "result": {
        const id = input.id as string;
        if (!id) {
          return { content: "Missing required parameter: id", isError: true };
        }
        const info = manager.getResult(id);
        if (!info) {
          return { content: `Sub-agent not found: ${id}`, isError: true };
        }

        const lines = [
          `ID: ${info.id}`,
          `Status: ${info.status}`,
          `Goal: ${info.goal}`,
          `Created: ${info.createdAt.toISOString()}`,
        ];
        if (info.completedAt) {
          lines.push(`Completed: ${info.completedAt.toISOString()}`);
        }
        if (info.result) {
          lines.push(`\nResult:\n${info.result}`);
        }
        if (info.error) {
          lines.push(`\nError: ${info.error}`);
        }

        return { content: lines.join("\n"), isError: false };
      }

      case "kill": {
        const id = input.id as string;
        if (!id) {
          return { content: "Missing required parameter: id", isError: true };
        }
        const killed = manager.kill(id);
        return {
          content: killed
            ? `Sub-agent ${id} has been killed.`
            : `Sub-agent ${id} not found or not running.`,
          isError: !killed,
        };
      }

      case "list": {
        const agents = manager.list();
        if (agents.length === 0) {
          return { content: "No sub-agents.", isError: false };
        }
        const lines = agents.map(
          (a) =>
            `- ${a.id} [${a.status}] ${a.goal.slice(0, 80)}${a.goal.length > 80 ? "..." : ""}`,
        );
        return {
          content: `Sub-agents (${agents.length}):\n${lines.join("\n")}`,
          isError: false,
        };
      }

      default:
        return {
          content: `Unknown action: ${action}. Valid: spawn, result, kill, list`,
          isError: true,
        };
    }
  },
};

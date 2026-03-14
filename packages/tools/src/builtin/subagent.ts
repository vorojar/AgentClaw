import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const subagentTool: Tool = {
  name: "subagent",
  category: "builtin",
  description:
    "Spawn sub-agents for task processing. " +
    "PREFERRED: Use spawn_and_wait with multiple goals — runs sequentially, returns all results at once. " +
    "ALTERNATIVE: Use spawn/result/kill for advanced control (background execution, steering). " +
    "Actions: spawn_and_wait (recommended), spawn, result, kill, list.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "Action: spawn_and_wait (recommended) | spawn | result | kill | list",
        enum: ["spawn_and_wait", "spawn", "result", "kill", "list"],
      },
      goals: {
        type: "array",
        items: { type: "string" },
        description:
          "Array of task descriptions (required for spawn_and_wait)",
      },
      goal: {
        type: "string",
        description: "Single task description (required for spawn)",
      },
      id: {
        type: "string",
        description: "Sub-agent ID (required for result/kill)",
      },
      maxIterations: {
        type: "number",
        description: "Max iterations per sub-agent (default: 8)",
      },
      model: {
        type: "string",
        description: "Override model name",
      },
      mode: {
        type: "string",
        description:
          '"full" (default, all tools) or "explore" (read-only: file_read, glob, grep, web_fetch, web_search)',
        enum: ["full", "explore"],
        default: "full",
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
    const mode = (input.mode as string) || "full";
    const EXPLORE_TOOLS = [
      "file_read",
      "glob",
      "grep",
      "web_fetch",
      "web_search",
      "shell",
    ];

    switch (action) {
      case "spawn_and_wait": {
        const goals = input.goals as string[];
        if (!goals || goals.length === 0) {
          return {
            content: "Missing required parameter: goals (array of strings)",
            isError: true,
          };
        }

        const results = await manager.spawnAndWait(
          goals,
          {
            maxIterations: input.maxIterations as number | undefined,
            model: input.model as string | undefined,
            allowedTools: mode === "explore" ? EXPLORE_TOOLS : undefined,
          },
          // Progress callback → sends real-time updates to UI
          (index, total, goal, status, result) => {
            if (context?.notifyUser) {
              const statusEmoji =
                status === "running"
                  ? "⏳"
                  : status === "completed"
                    ? "✓"
                    : "✗";
              const _line = result
                ? `${statusEmoji} [${index + 1}/${total}] ${goal}\n${result}`
                : `${statusEmoji} [${index + 1}/${total}] ${goal}`;
              context.notifyUser(
                JSON.stringify({ subagent: true, index, total, goal, status, result: result ?? null }),
              );
            }
          },
        );

        const lines = results.map((r, i) => {
          const icon = r.status === "completed" ? "✓" : "✗";
          const body = r.result ?? r.error ?? "No output";
          return `${icon} Task ${i + 1}: ${r.goal}\n${body}`;
        });

        return {
          content: lines.join("\n\n"),
          isError: results.some((r) => r.status === "failed"),
        };
      }

      case "spawn": {
        const goal = input.goal as string;
        if (!goal) {
          return { content: "Missing required parameter: goal", isError: true };
        }
        const id = manager.spawn(goal, {
          maxIterations: input.maxIterations as number | undefined,
          model: input.model as string | undefined,
          allowedTools: mode === "explore" ? EXPLORE_TOOLS : undefined,
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
          content: `Unknown action: ${action}. Valid: spawn_and_wait, spawn, result, kill, list`,
          isError: true,
        };
    }
  },
};

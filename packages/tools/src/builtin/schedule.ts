import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const scheduleTool: Tool = {
  name: "schedule",
  description:
    "Create, list, or delete recurring scheduled tasks. Use this when the user wants something done on a regular schedule (e.g. 'every morning at 8am', 'every hour', 'every Monday').",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "The action to perform: 'create', 'list', or 'delete'",
        enum: ["create", "list", "delete"],
      },
      cron: {
        type: "string",
        description:
          "Cron expression for the schedule (only for 'create'). Examples: '0 8 * * *' (daily 8am), '0 */2 * * *' (every 2 hours), '0 9 * * 1' (Monday 9am)",
      },
      message: {
        type: "string",
        description:
          "The notification message to send when the task triggers (only for 'create')",
      },
      name: {
        type: "string",
        description: "A short name for the task (only for 'create')",
      },
      task_id: {
        type: "string",
        description: "The task ID to delete (only for 'delete')",
      },
    },
    required: ["action"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const action = input.action as string;

    // We need access to the scheduler - pass it through context
    if (!context?.scheduler) {
      return {
        content: "Scheduler is not available in this context.",
        isError: true,
      };
    }

    const scheduler = context.scheduler;

    switch (action) {
      case "create": {
        const cron = input.cron as string;
        const message = input.message as string;
        const name = input.name as string | undefined;

        if (!cron || !message) {
          return {
            content:
              "Both 'cron' and 'message' are required for creating a task.",
            isError: true,
          };
        }

        const task = scheduler.create({
          name: name ?? message.slice(0, 30),
          cron,
          action: message,
          enabled: true,
        });

        return {
          content: `Scheduled task created!\nID: ${task.id}\nName: ${task.name}\nCron: ${cron}\nNext run: ${task.nextRunAt?.toLocaleString() ?? "unknown"}`,
          isError: false,
        };
      }

      case "list": {
        const tasks = scheduler.list();
        if (tasks.length === 0) {
          return { content: "No scheduled tasks.", isError: false };
        }
        const lines = tasks.map(
          (t) =>
            `• ${t.name} (ID: ${t.id})\n  Cron: ${t.cron}\n  Next: ${t.nextRunAt?.toLocaleString() ?? "N/A"}\n  Message: ${t.action}`,
        );
        return { content: lines.join("\n\n"), isError: false };
      }

      case "delete": {
        const taskId = input.task_id as string;
        if (!taskId) {
          return {
            content: "'task_id' is required for delete.",
            isError: true,
          };
        }
        const deleted = scheduler.delete(taskId);
        if (!deleted) {
          return { content: `Task not found: ${taskId}`, isError: true };
        }
        return { content: `Task ${taskId} deleted.`, isError: false };
      }

      default:
        return { content: `Unknown action: ${action}`, isError: true };
    }
  },
};

import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const scheduleTool: Tool = {
  name: "schedule",
  description: "Create, list, or delete recurring scheduled tasks.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "delete"] },
      cron: { type: "string" },
      message: { type: "string" },
      name: { type: "string" },
      task_id: { type: "string" },
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

import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const scheduleTool: Tool = {
  name: "schedule",
  description:
    "The ONLY way to create recurring/scheduled tasks. Uses built-in cron scheduler. Do NOT use shell/bash/OS-level scheduling (crontab, Windows Task Scheduler, etc.).",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      op: {
        type: "string",
        enum: ["create", "list", "delete"],
        description: "Operation type.",
      },
      cron: {
        type: "string",
        description:
          "Cron expression (5 fields: min hour day month weekday). E.g. '0 9 * * *' = daily 9am.",
      },
      prompt: {
        type: "string",
        description:
          "The task instruction to execute when triggered. ONLY the action itself — no time/schedule words (those belong in cron). Example: '让Claude code执行/ai-daily-post' NOT '每天早上8点让Claude code执行/ai-daily-post'.",
      },
      name: {
        type: "string",
        description: "Short display name for the task.",
      },
      task_id: {
        type: "string",
        description: "Task ID (for delete).",
      },
    },
    required: ["op"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const op = (input.op ?? input.action) as string;

    // We need access to the scheduler - pass it through context
    if (!context?.scheduler) {
      return {
        content: "Scheduler is not available in this context.",
        isError: true,
      };
    }

    const scheduler = context.scheduler;

    switch (op) {
      case "create": {
        const cron = input.cron as string;
        const rawMessage = (input.prompt ?? input.message) as string;
        const name = input.name as string | undefined;

        if (!cron || !rawMessage) {
          return {
            content:
              "Both 'cron' and 'message' are required for creating a task.",
            isError: true,
          };
        }

        // Strip time/schedule info that LLM often copies from user message
        const message = rawMessage
          .replace(
            /^(每天|每周[一二三四五六日]?|每月|每小时|每隔?\d+[分小时天周月])\s*/g,
            "",
          )
          .replace(
            /(早上|上午|中午|下午|晚上|凌晨)?\d{1,2}[点时:：]\d{0,2}分?\s*/g,
            "",
          )
          .replace(/^(at\s+)?\d{1,2}:\d{2}\s*(am|pm)?\s*/i, "")
          .replace(/^(daily|weekly|monthly|hourly|every\s+\w+)\s*/i, "")
          .trim();

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
        return { content: `Unknown op: ${op}`, isError: true };
    }
  },
};

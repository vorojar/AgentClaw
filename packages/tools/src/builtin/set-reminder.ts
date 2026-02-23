import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

/**
 * Convert a delay in seconds to a one-shot cron expression.
 * We schedule it at the exact future time (second precision via croner).
 */
function delayToCron(delaySec: number): { cron: string; fireAt: Date } {
  const fireAt = new Date(Date.now() + delaySec * 1000);
  const m = fireAt.getMinutes();
  const h = fireAt.getHours();
  const d = fireAt.getDate();
  const mon = fireAt.getMonth() + 1;
  // cron: minute hour day month *
  return { cron: `${m} ${h} ${d} ${mon} *`, fireAt };
}

export const setReminderTool: Tool = {
  name: "set_reminder",
  description: "Set a one-time reminder after a delay.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string" },
      delay_seconds: { type: "number" },
    },
    required: ["message", "delay_seconds"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const message = input.message as string;
    const delaySec = input.delay_seconds as number;

    if (delaySec <= 0 || delaySec > 86400) {
      return {
        content: "Delay must be between 1 and 86400 seconds (24 hours).",
        isError: true,
      };
    }

    const fireAt = new Date(Date.now() + delaySec * 1000);

    // Preferred: use scheduler (gateway mode) — broadcasts to all channels on fire
    if (context?.scheduler) {
      const { cron } = delayToCron(delaySec);
      const task = context.scheduler.create({
        name: `⏰ ${message.slice(0, 30)}`,
        cron,
        action: message,
        enabled: true,
        oneShot: true,
      });

      return {
        content: `Reminder set (ID: ${task.id}). Will notify at ${fireAt.toLocaleTimeString()}: "${message}"`,
        isError: false,
      };
    }

    // Fallback: use setTimeout + notifyUser (e.g. CLI mode)
    if (context?.notifyUser) {
      const notifyUser = context.notifyUser;
      setTimeout(() => {
        notifyUser(`⏰ 提醒：${message}`).catch((err) => {
          console.error("[set_reminder] Failed to notify user:", err);
        });
      }, delaySec * 1000);

      return {
        content: `Reminder set. Will notify at ${fireAt.toLocaleTimeString()}: "${message}"`,
        isError: false,
      };
    }

    return {
      content: "Neither scheduler nor notification system is available.",
      isError: true,
    };
  },
};

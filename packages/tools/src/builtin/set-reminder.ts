import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const setReminderTool: Tool = {
  name: "set_reminder",
  description:
    "Set a one-time reminder that will notify the user after a specified delay. Use this when the user asks to be reminded of something.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The reminder message to send to the user",
      },
      delay_seconds: {
        type: "number",
        description:
          "How many seconds from now to send the reminder (e.g. 60 for 1 minute, 3600 for 1 hour)",
      },
    },
    required: ["message", "delay_seconds"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const message = input.message as string;
    const delaySec = input.delay_seconds as number;

    if (!context?.notifyUser) {
      return {
        content: "Notification system is not available in this context.",
        isError: true,
      };
    }

    if (delaySec <= 0 || delaySec > 86400) {
      return {
        content: "Delay must be between 1 and 86400 seconds (24 hours).",
        isError: true,
      };
    }

    const notifyUser = context.notifyUser;
    const fireAt = new Date(Date.now() + delaySec * 1000);

    setTimeout(() => {
      notifyUser(`⏰ 提醒：${message}`).catch((err) => {
        console.error("[set_reminder] Failed to notify user:", err);
      });
    }, delaySec * 1000);

    return {
      content: `Reminder set. Will notify at ${fireAt.toLocaleTimeString()}: "${message}"`,
      isError: false,
    };
  },
};

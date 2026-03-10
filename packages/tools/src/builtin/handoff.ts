import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const handoffTool: Tool = {
  name: "handoff",
  description:
    "Hand off the current conversation to another agent. Use when the user's request is better suited for a specialist agent (e.g., coding tasks → Coder, writing → Writer). The target agent takes over the conversation with its own expertise and tools.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      targetAgent: {
        type: "string",
        description:
          "ID of the agent to hand off to (from the agent roster in system prompt)",
      },
      reason: {
        type: "string",
        description:
          "Brief reason for the handoff (will be shown to the target agent)",
      },
    },
    required: ["targetAgent", "reason"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const targetAgent = input.targetAgent as string;
    const reason = input.reason as string;

    if (!targetAgent || !reason) {
      return { content: "Missing targetAgent or reason", isError: true };
    }

    const agents = context?.agents;
    if (!agents || agents.length === 0) {
      return { content: "No agents available for handoff", isError: true };
    }

    const target = agents.find((a) => a.id === targetAgent);
    if (!target) {
      const available = agents.map((a) => `${a.id} (${a.name})`).join(", ");
      return {
        content: `Agent "${targetAgent}" not found. Available: ${available}`,
        isError: true,
      };
    }

    return {
      content: `Handing off to ${target.name}. Reason: ${reason}`,
      handoffTo: targetAgent,
    };
  },
};

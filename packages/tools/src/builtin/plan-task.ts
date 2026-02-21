import type { Tool, ToolResult, ToolExecutionContext } from "@agentclaw/types";

export const planTaskTool: Tool = {
  name: "plan_task",
  description:
    "Decompose a complex multi-step task into a plan and execute step by step.",
  category: "builtin",
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string" },
      context: { type: "string" },
    },
    required: ["goal"],
  },

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const goal = input.goal as string;
    const taskContext = input.context as string | undefined;

    if (!context?.planner) {
      return {
        content: "Planner is not available in this context.",
        isError: true,
      };
    }

    try {
      // 1. Create plan
      const plan = await context.planner.createPlan(goal, taskContext);
      const stepCount = plan.steps.length;

      const results: string[] = [];
      results.push(`Plan created: ${stepCount} steps`);
      results.push(
        plan.steps.map((s, i) => `  ${i + 1}. ${s.description}`).join("\n"),
      );
      results.push("");

      // 2. Execute steps until done
      let maxRounds = stepCount + 2; // safety limit
      while (maxRounds-- > 0) {
        const executed = await context.planner.executeNext(plan.id);
        if (executed.length === 0) break;

        for (const step of executed) {
          if (step.status === "completed") {
            results.push(`\u2713 ${step.description}`);
            if (step.result) {
              // Truncate long results
              const truncated =
                step.result.length > 2000
                  ? step.result.slice(0, 2000) + "... [truncated]"
                  : step.result;
              results.push(truncated);
            }
          } else if (step.status === "failed") {
            results.push(
              `\u2717 ${step.description}: ${step.error ?? "unknown error"}`,
            );
          }
          results.push("");
        }
      }

      return {
        content: results.join("\n"),
        isError: false,
        metadata: { planId: plan.id, stepCount },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Planning failed: ${message}`,
        isError: true,
      };
    }
  },
};

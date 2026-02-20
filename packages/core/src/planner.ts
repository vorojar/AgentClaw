import type {
  Plan,
  PlanStep,
  PlanStatus,
  Planner,
  LLMProvider,
  AgentLoop,
  Message,
} from "@agentclaw/types";
import { generateId } from "@agentclaw/providers";

/** Options for constructing a SimplePlanner */
export interface SimplePlannerOptions {
  /** LLM provider used to decompose goals into steps and replan */
  provider: LLMProvider;
  /** Factory that creates an AgentLoop bound to a conversation */
  agentLoopFactory: (conversationId: string) => AgentLoop;
}

/**
 * Extract the text content from a Message, which may be a plain string
 * or an array of ContentBlocks.
 */
function extractText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

/**
 * Try to extract a JSON array from a string that may contain markdown
 * fences or surrounding prose.
 */
function extractJsonArray(raw: string): unknown[] | null {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  // Try parsing the whole text as JSON
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    // If it's an object with a "steps" key, use that
    if (parsed && Array.isArray(parsed.steps)) return parsed.steps;
    return null;
  } catch {
    // Try to find a JSON array in the text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // fall through
      }
    }
    return null;
  }
}

/**
 * Build PlanStep objects from raw LLM-parsed step data.
 * Accepts loose shapes — each item needs at minimum a description or a string.
 */
function buildSteps(items: unknown[]): PlanStep[] {
  return items.map((item, index) => {
    const obj =
      typeof item === "string"
        ? { description: item }
        : (item as Record<string, unknown>);
    const description =
      (obj.description as string) ??
      (obj.step as string) ??
      (obj.task as string) ??
      String(item);
    const dependsOnRaw = obj.dependsOn ?? obj.depends_on ?? [];
    const dependsOn = Array.isArray(dependsOnRaw)
      ? (dependsOnRaw as string[])
      : [];
    const toolHint =
      (obj.toolHint as string) ??
      (obj.tool_hint as string) ??
      (obj.tool as string) ??
      undefined;

    return {
      id: generateId(),
      description,
      status: "pending" as PlanStatus,
      dependsOn,
      toolHint,
    };
  });
}

const PLAN_PROMPT = `You are a task planner. Break the following goal into a list of concrete, executable steps.

Return ONLY a JSON array. Each element must be an object with these fields:
- "description": a short, actionable description of the step
- "dependsOn": an array of step indices (0-based) that must complete before this step. Use [] if there are no dependencies.
- "toolHint": (optional) the name of a tool likely needed for this step

Example output:
[
  { "description": "Search for relevant files", "dependsOn": [], "toolHint": "file_search" },
  { "description": "Read the main config", "dependsOn": [0] },
  { "description": "Apply the change", "dependsOn": [1], "toolHint": "file_write" }
]

Do NOT include any explanation — only the JSON array.`;

export class SimplePlanner implements Planner {
  private provider: LLMProvider;
  private agentLoopFactory: (conversationId: string) => AgentLoop;
  private plans: Map<string, Plan> = new Map();

  constructor(options: SimplePlannerOptions) {
    this.provider = options.provider;
    this.agentLoopFactory = options.agentLoopFactory;
  }

  // ── createPlan ──────────────────────────────────────────────

  async createPlan(goal: string, context?: string): Promise<Plan> {
    const userContent = context
      ? `Goal: ${goal}\n\nContext:\n${context}`
      : `Goal: ${goal}`;

    const response = await this.provider.chat({
      messages: [
        {
          id: generateId(),
          role: "user" as const,
          content: userContent,
          createdAt: new Date(),
        },
      ],
      systemPrompt: PLAN_PROMPT,
      temperature: 0.3,
      maxTokens: 4096,
    });

    const rawText = extractText(response.message);
    const parsed = extractJsonArray(rawText);

    let steps: PlanStep[];

    if (parsed && parsed.length > 0) {
      const rawSteps = buildSteps(parsed);

      // The LLM returns dependsOn as indices — remap to actual step IDs
      steps = rawSteps.map((step, _i, allSteps) => ({
        ...step,
        dependsOn: step.dependsOn
          .map((dep) => {
            const idx = typeof dep === "number" ? dep : Number(dep);
            return Number.isFinite(idx) && idx >= 0 && idx < allSteps.length
              ? allSteps[idx].id
              : dep; // keep as-is if already an id string
          })
          .filter((id): id is string => typeof id === "string"),
      }));
    } else {
      // Fallback: create a single-step plan from the raw text
      steps = [
        {
          id: generateId(),
          description: rawText || goal,
          status: "pending" as PlanStatus,
          dependsOn: [],
        },
      ];
    }

    const plan: Plan = {
      id: generateId(),
      goal,
      status: "pending",
      steps,
      createdAt: new Date(),
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  // ── executeNext ─────────────────────────────────────────────

  async executeNext(planId: string): Promise<PlanStep[]> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    if (plan.status === "completed" || plan.status === "cancelled") {
      return [];
    }

    // Mark the plan as active on first execution
    if (plan.status === "pending") {
      plan.status = "active";
    }

    // Find steps whose dependencies are all completed and that are still pending
    const readySteps = plan.steps.filter((step) => {
      if (step.status !== "pending") return false;
      return step.dependsOn.every((depId) => {
        const dep = plan.steps.find((s) => s.id === depId);
        return dep?.status === "completed";
      });
    });

    if (readySteps.length === 0) {
      // Check if the plan is done or stuck
      this.updatePlanStatus(plan);
      return [];
    }

    // Execute all ready steps (could be parallelised, but we run sequentially
    // to keep resource usage predictable)
    const executed: PlanStep[] = [];

    for (const step of readySteps) {
      step.status = "active";

      const conversationId = `${planId}-${step.id}`;
      const agentLoop = this.agentLoopFactory(conversationId);

      try {
        const prompt = this.buildStepPrompt(plan, step);
        const message = await agentLoop.run(prompt, conversationId);
        const resultText = extractText(message);

        step.status = "completed";
        step.result = resultText;
      } catch (err: unknown) {
        step.status = "failed";
        step.error = err instanceof Error ? err.message : String(err);
      }

      executed.push(step);
    }

    this.updatePlanStatus(plan);
    return executed;
  }

  // ── replan ──────────────────────────────────────────────────

  async replan(planId: string, reason: string): Promise<Plan> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    // Gather context from completed / failed steps
    const completedSummary = plan.steps
      .filter((s) => s.status === "completed")
      .map((s) => `- [DONE] ${s.description}: ${s.result ?? "(no result)"}`)
      .join("\n");

    const failedSummary = plan.steps
      .filter((s) => s.status === "failed")
      .map(
        (s) => `- [FAILED] ${s.description}: ${s.error ?? "(unknown error)"}`,
      )
      .join("\n");

    const pendingSummary = plan.steps
      .filter((s) => s.status === "pending" || s.status === "active")
      .map((s) => `- [PENDING] ${s.description}`)
      .join("\n");

    const contextMessage = [
      `Original goal: ${plan.goal}`,
      "",
      "Progress so far:",
      completedSummary || "(none completed)",
      "",
      "Failures:",
      failedSummary || "(none failed)",
      "",
      "Remaining (to be replanned):",
      pendingSummary || "(none pending)",
      "",
      `Reason for replanning: ${reason}`,
      "",
      "Produce a new list of remaining steps (JSON array) that accounts for the progress made and the reason for replanning.",
    ].join("\n");

    const response = await this.provider.chat({
      messages: [
        {
          id: generateId(),
          role: "user" as const,
          content: contextMessage,
          createdAt: new Date(),
        },
      ],
      systemPrompt: PLAN_PROMPT,
      temperature: 0.3,
      maxTokens: 4096,
    });

    const rawText = extractText(response.message);
    const parsed = extractJsonArray(rawText);

    let newSteps: PlanStep[];

    if (parsed && parsed.length > 0) {
      const rawSteps = buildSteps(parsed);
      // Remap index-based dependsOn to IDs (same logic as createPlan)
      newSteps = rawSteps.map((step, _i, allSteps) => ({
        ...step,
        dependsOn: step.dependsOn
          .map((dep) => {
            const idx = typeof dep === "number" ? dep : Number(dep);
            return Number.isFinite(idx) && idx >= 0 && idx < allSteps.length
              ? allSteps[idx].id
              : dep;
          })
          .filter((id): id is string => typeof id === "string"),
      }));
    } else {
      newSteps = [
        {
          id: generateId(),
          description: rawText || plan.goal,
          status: "pending" as PlanStatus,
          dependsOn: [],
        },
      ];
    }

    // Replace pending/active steps with the new ones, keep completed/failed
    const keptSteps = plan.steps.filter(
      (s) => s.status === "completed" || s.status === "failed",
    );
    plan.steps = [...keptSteps, ...newSteps];
    plan.status = "active";

    return plan;
  }

  // ── getPlan ─────────────────────────────────────────────────

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.plans.get(planId);
  }

  // ── cancel ──────────────────────────────────────────────────

  async cancel(planId: string): Promise<void> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    plan.status = "cancelled";
    for (const step of plan.steps) {
      if (step.status === "pending" || step.status === "active") {
        step.status = "cancelled";
      }
    }
  }

  // ── list ────────────────────────────────────────────────────

  async list(status?: PlanStatus): Promise<Plan[]> {
    const all = Array.from(this.plans.values());
    if (!status) return all;
    return all.filter((p) => p.status === status);
  }

  // ── Private helpers ─────────────────────────────────────────

  private buildStepPrompt(plan: Plan, step: PlanStep): string {
    // Provide the agent with the overall goal plus results from dependencies
    const parts: string[] = [
      `You are executing step ${step.id} of a plan.`,
      `Overall goal: ${plan.goal}`,
      `Current step: ${step.description}`,
    ];

    if (step.toolHint) {
      parts.push(`Hint: you may want to use the "${step.toolHint}" tool.`);
    }

    // Include results from dependency steps for context
    const depResults = step.dependsOn
      .map((depId) => plan.steps.find((s) => s.id === depId))
      .filter((s): s is PlanStep => s !== undefined && s.status === "completed")
      .map((s) => `- ${s.description}: ${s.result ?? "(no result)"}`);

    if (depResults.length > 0) {
      parts.push("", "Results from prerequisite steps:", ...depResults);
    }

    parts.push("", "Execute this step and provide the result.");
    return parts.join("\n");
  }

  private updatePlanStatus(plan: Plan): void {
    const allDone = plan.steps.every(
      (s) =>
        s.status === "completed" ||
        s.status === "failed" ||
        s.status === "cancelled",
    );

    if (!allDone) return;

    const anyFailed = plan.steps.some((s) => s.status === "failed");

    if (anyFailed) {
      plan.status = "failed";
    } else {
      plan.status = "completed";
      plan.completedAt = new Date();
      // Aggregate results
      plan.result = plan.steps
        .filter((s) => s.status === "completed" && s.result)
        .map((s) => s.result)
        .join("\n\n");
    }
  }
}

/**
 * WorkflowRunner — deterministic orchestration engine
 *
 * Executes a sequence of workflow steps without LLM decision-making.
 * Steps run sequentially by default; a step with type="parallel" runs
 * its sub-steps concurrently via Promise.all.
 *
 * Template variables: step inputs support `{{stepId.content}}` to
 * reference a previous step's output, and `{{input.fieldName}}` for
 * workflow-level input variables.
 */

import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepResult,
  WorkflowResult,
  ToolExecutionContext,
  Tool,
} from "@agentclaw/types";

/* ── Template resolution ──────────────────────────────── */

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g;

function resolveTemplates(value: unknown, ctx: WorkflowContext): unknown {
  if (typeof value === "string") {
    return value.replace(TEMPLATE_RE, (_match, path: string) => {
      const trimmed = path.trim();
      // {{stepId.content}} or {{stepId.isError}}
      const dotIdx = trimmed.indexOf(".");
      if (dotIdx === -1) return ctx.get(trimmed) ?? "";
      const ns = trimmed.slice(0, dotIdx);
      const key = trimmed.slice(dotIdx + 1);
      if (ns === "input") {
        return String(ctx.inputs[key] ?? "");
      }
      const stepResult = ctx.stepResults.get(ns);
      if (!stepResult) return "";
      if (key === "content") return stepResult.content;
      if (key === "isError") return String(stepResult.isError);
      if (key === "durationMs") return String(stepResult.durationMs);
      return "";
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplates(v, ctx));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveTemplates(v, ctx);
    }
    return out;
  }
  return value;
}

/* ── Workflow execution context ───────────────────────── */

class WorkflowContext {
  readonly stepResults = new Map<string, WorkflowStepResult>();
  readonly inputs: Record<string, unknown>;

  constructor(inputs?: Record<string, unknown>) {
    this.inputs = inputs ?? {};
  }

  get(key: string): string | undefined {
    const r = this.stepResults.get(key);
    return r?.content;
  }

  set(result: WorkflowStepResult): void {
    this.stepResults.set(result.stepId, result);
  }
}

/* ── Condition evaluation ─────────────────────────────── */

function evaluateCondition(condition: string, ctx: WorkflowContext): boolean {
  const resolved = resolveTemplates(condition, ctx) as string;
  // Truthy check: non-empty, not "false", not "0"
  return !!resolved && resolved !== "false" && resolved !== "0";
}

/* ── WorkflowRunner ───────────────────────────────────── */

export interface WorkflowRunnerOptions {
  /** Function to resolve a tool by name */
  getTool: (name: string) => Tool | undefined;
  /** Optional tool execution context (for sendFile, promptUser etc.) */
  toolContext?: ToolExecutionContext;
  /** Optional AbortSignal */
  abortSignal?: AbortSignal;
  /** Callback for step completion */
  onStepComplete?: (result: WorkflowStepResult) => void;
}

export class WorkflowRunner {
  private readonly getTool: (name: string) => Tool | undefined;
  private readonly toolContext?: ToolExecutionContext;
  private readonly abortSignal?: AbortSignal;
  private readonly onStepComplete?: (result: WorkflowStepResult) => void;

  constructor(options: WorkflowRunnerOptions) {
    this.getTool = options.getTool;
    this.toolContext = options.toolContext;
    this.abortSignal = options.abortSignal;
    this.onStepComplete = options.onStepComplete;
  }

  /**
   * Execute a workflow definition with optional input variables.
   */
  async run(
    workflow: WorkflowDefinition,
    inputs?: Record<string, unknown>,
  ): Promise<WorkflowResult> {
    const ctx = new WorkflowContext(inputs);
    const allResults: WorkflowStepResult[] = [];
    const startTime = Date.now();

    try {
      for (const step of workflow.steps) {
        if (this.abortSignal?.aborted) {
          return {
            success: false,
            stepResults: allResults,
            totalDurationMs: Date.now() - startTime,
            error: "Workflow aborted",
          };
        }

        const results = await this.executeStep(step, ctx);
        for (const r of results) {
          allResults.push(r);
          ctx.set(r);
          this.onStepComplete?.(r);
        }

        // Check if any step failed with onError="stop"
        const failed = results.find((r) => r.isError);
        if (failed && (step.onError ?? "stop") === "stop") {
          return {
            success: false,
            stepResults: allResults,
            totalDurationMs: Date.now() - startTime,
            error: `Step "${failed.stepId}" failed: ${failed.content}`,
          };
        }
      }

      return {
        success: true,
        stepResults: allResults,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        stepResults: allResults,
        totalDurationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeStep(
    step: WorkflowStep,
    ctx: WorkflowContext,
  ): Promise<WorkflowStepResult[]> {
    // Condition check
    if (step.condition && !evaluateCondition(step.condition, ctx)) {
      return [
        {
          stepId: step.id,
          content: "skipped (condition not met)",
          isError: false,
          durationMs: 0,
        },
      ];
    }

    if (step.type === "parallel") {
      return this.executeParallel(step, ctx);
    }

    return [await this.executeTool(step, ctx)];
  }

  private async executeTool(
    step: WorkflowStep,
    ctx: WorkflowContext,
  ): Promise<WorkflowStepResult> {
    const toolName = step.toolName;
    if (!toolName) {
      return {
        stepId: step.id,
        content: "No toolName specified",
        isError: true,
        durationMs: 0,
      };
    }

    const tool = this.getTool(toolName);
    if (!tool) {
      return {
        stepId: step.id,
        content: `Tool "${toolName}" not found`,
        isError: true,
        durationMs: 0,
      };
    }

    // Resolve template variables in tool input
    const rawInput = step.toolInput ?? {};
    const resolvedInput = resolveTemplates(rawInput, ctx) as Record<
      string,
      unknown
    >;

    const start = Date.now();
    try {
      const result = await tool.execute(resolvedInput, this.toolContext);
      return {
        stepId: step.id,
        content: result.content,
        isError: !!result.isError,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        stepId: step.id,
        content: err instanceof Error ? err.message : String(err),
        isError: true,
        durationMs: Date.now() - start,
      };
    }
  }

  private async executeParallel(
    step: WorkflowStep,
    ctx: WorkflowContext,
  ): Promise<WorkflowStepResult[]> {
    const subSteps = step.steps ?? [];
    if (subSteps.length === 0) {
      return [
        {
          stepId: step.id,
          content: "No sub-steps in parallel block",
          isError: true,
          durationMs: 0,
        },
      ];
    }

    // Snapshot current context for all parallel steps (they share read but not write)
    const results = await Promise.all(
      subSteps.map((sub) => this.executeStep(sub, ctx)),
    );

    return results.flat();
  }
}

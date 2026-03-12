/**
 * Trajectory Evaluation Framework
 *
 * Evaluates agent traces against "golden" test cases to verify:
 * 1. Tool selection correctness — did the agent call the right tools?
 * 2. Tool parameter correctness — were the inputs correct?
 * 3. Outcome correctness — was the final response acceptable?
 *
 * Inspired by Google's AgentOps 3-layer evaluation:
 * - Layer 1: Component-level (deterministic, unit tests)
 * - Layer 2: Trajectory (reasoning path correctness)
 * - Layer 3: Outcome (semantic correctness of final answer)
 */

import type { Trace, TraceStep } from "@agentclaw/types";

/* ── Golden test case definition ─────────────────────── */

/** Expected tool call in the trajectory */
export interface ExpectedToolCall {
  /** Tool name (exact match) */
  name: string;
  /** Optional: key-value pairs that must appear in the tool input */
  inputContains?: Record<string, unknown>;
  /** Optional: should this call be an error? */
  expectError?: boolean;
}

/** A golden test case for trajectory evaluation */
export interface TrajectoryTestCase {
  /** Test case identifier */
  id: string;
  /** Description of what this test validates */
  description: string;
  /** The user input that was sent */
  userInput: string;
  /** Expected tool calls in order (subset matching — extra calls are OK) */
  expectedTools: ExpectedToolCall[];
  /** Optional: tools that must NOT be called */
  forbiddenTools?: string[];
  /** Optional: regex or substring that the final response must match */
  responseContains?: string;
  /** Optional: regex or substring that the final response must NOT contain */
  responseNotContains?: string;
  /** Optional: expected model name */
  expectedModel?: string;
  /** Optional: max allowed duration in ms */
  maxDurationMs?: number;
}

/* ── Evaluation results ──────────────────────────────── */

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message?: string;
}

export interface TrajectoryEvalResult {
  testId: string;
  description: string;
  passed: boolean;
  checks: CheckResult[];
  traceId?: string;
}

export interface EvalReport {
  totalTests: number;
  passed: number;
  failed: number;
  results: TrajectoryEvalResult[];
  timestamp: Date;
}

/* ── Utility: extract tool results from trace steps ──── */

interface ToolCallPair {
  name: string;
  input?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
}

function extractToolCalls(steps: TraceStep[]): ToolCallPair[] {
  const pairs: ToolCallPair[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.type === "tool_call") {
      const pair: ToolCallPair = {
        name: (step.name as string) ?? "unknown",
        input: step.input as Record<string, unknown> | undefined,
      };
      // Look ahead for tool_result
      if (i + 1 < steps.length && steps[i + 1].type === "tool_result") {
        pair.content = steps[i + 1].content as string | undefined;
        pair.isError = steps[i + 1].isError as boolean | undefined;
        i += 2;
      } else {
        i++;
      }
      pairs.push(pair);
    } else {
      i++;
    }
  }
  return pairs;
}

/* ── Core evaluation logic ───────────────────────────── */

/**
 * Evaluate a single trace against a test case.
 */
export function evaluateTrace(
  testCase: TrajectoryTestCase,
  trace: Trace,
): TrajectoryEvalResult {
  const checks: CheckResult[] = [];
  const toolCalls = extractToolCalls(
    typeof trace.steps === "string" ? JSON.parse(trace.steps) : trace.steps,
  );
  const toolNames = toolCalls.map((tc) => tc.name);

  // ── Check 1: Tool selection (ordered subset matching) ──
  {
    let searchFrom = 0;
    let allFound = true;
    const missing: string[] = [];

    for (const expected of testCase.expectedTools) {
      const idx = toolNames.indexOf(expected.name, searchFrom);
      if (idx === -1) {
        allFound = false;
        missing.push(expected.name);
      } else {
        searchFrom = idx + 1;
      }
    }

    checks.push({
      name: "tool_selection",
      status: allFound ? "pass" : "fail",
      message: allFound
        ? `All ${testCase.expectedTools.length} expected tools found in order`
        : `Missing tools: ${missing.join(", ")}`,
    });
  }

  // ── Check 2: Tool parameter correctness ──
  for (const expected of testCase.expectedTools) {
    if (!expected.inputContains) continue;

    const matchingCall = toolCalls.find((tc) => tc.name === expected.name);
    if (!matchingCall) {
      checks.push({
        name: `params:${expected.name}`,
        status: "fail",
        message: `Tool "${expected.name}" not found in trace`,
      });
      continue;
    }

    const actualInput = matchingCall.input ?? {};
    let allMatch = true;
    const mismatches: string[] = [];

    for (const [key, expectedValue] of Object.entries(
      expected.inputContains,
    )) {
      const actualValue = actualInput[key];
      if (typeof expectedValue === "string") {
        // String contains check (more lenient than exact match)
        if (
          !String(actualValue ?? "").includes(expectedValue)
        ) {
          allMatch = false;
          mismatches.push(
            `${key}: expected to contain "${expectedValue}", got "${actualValue}"`,
          );
        }
      } else if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        allMatch = false;
        mismatches.push(
          `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
        );
      }
    }

    checks.push({
      name: `params:${expected.name}`,
      status: allMatch ? "pass" : "fail",
      message: allMatch ? "All parameters match" : mismatches.join("; "),
    });
  }

  // ── Check 3: Error expectations ──
  for (const expected of testCase.expectedTools) {
    if (expected.expectError === undefined) continue;

    const matchingCall = toolCalls.find((tc) => tc.name === expected.name);
    if (!matchingCall) continue;

    const actualError = !!matchingCall.isError;
    checks.push({
      name: `error:${expected.name}`,
      status: actualError === expected.expectError ? "pass" : "fail",
      message:
        actualError === expected.expectError
          ? `Error status matches (${expected.expectError})`
          : `Expected isError=${expected.expectError}, got ${actualError}`,
    });
  }

  // ── Check 4: Forbidden tools ──
  if (testCase.forbiddenTools?.length) {
    const called = testCase.forbiddenTools.filter((t) =>
      toolNames.includes(t),
    );
    checks.push({
      name: "forbidden_tools",
      status: called.length === 0 ? "pass" : "fail",
      message:
        called.length === 0
          ? "No forbidden tools called"
          : `Forbidden tools called: ${called.join(", ")}`,
    });
  }

  // ── Check 5: Response content ──
  if (testCase.responseContains) {
    const response = trace.response ?? "";
    const pattern = testCase.responseContains;
    let matches: boolean;
    try {
      matches = new RegExp(pattern, "i").test(response);
    } catch {
      matches = response.toLowerCase().includes(pattern.toLowerCase());
    }
    checks.push({
      name: "response_contains",
      status: matches ? "pass" : "fail",
      message: matches
        ? `Response matches "${pattern}"`
        : `Response does not match "${pattern}"`,
    });
  }

  if (testCase.responseNotContains) {
    const response = trace.response ?? "";
    const pattern = testCase.responseNotContains;
    let matches: boolean;
    try {
      matches = new RegExp(pattern, "i").test(response);
    } catch {
      matches = response.toLowerCase().includes(pattern.toLowerCase());
    }
    checks.push({
      name: "response_not_contains",
      status: matches ? "fail" : "pass",
      message: matches
        ? `Response should NOT match "${pattern}" but it does`
        : `Response correctly does not match "${pattern}"`,
    });
  }

  // ── Check 6: Model ──
  if (testCase.expectedModel) {
    checks.push({
      name: "model",
      status: trace.model === testCase.expectedModel ? "pass" : "fail",
      message:
        trace.model === testCase.expectedModel
          ? `Model matches: ${testCase.expectedModel}`
          : `Expected model "${testCase.expectedModel}", got "${trace.model}"`,
    });
  }

  // ── Check 7: Duration ──
  if (testCase.maxDurationMs) {
    checks.push({
      name: "duration",
      status: trace.durationMs <= testCase.maxDurationMs ? "pass" : "fail",
      message:
        trace.durationMs <= testCase.maxDurationMs
          ? `Duration ${trace.durationMs}ms within limit ${testCase.maxDurationMs}ms`
          : `Duration ${trace.durationMs}ms exceeds limit ${testCase.maxDurationMs}ms`,
    });
  }

  const passed = checks.every((c) => c.status !== "fail");

  return {
    testId: testCase.id,
    description: testCase.description,
    passed,
    checks,
    traceId: trace.id,
  };
}

/**
 * Run a batch of test cases against traces, matching by userInput.
 */
export function evaluateBatch(
  testCases: TrajectoryTestCase[],
  traces: Trace[],
): EvalReport {
  const results: TrajectoryEvalResult[] = [];

  for (const tc of testCases) {
    // Find the most recent trace matching this test case's userInput
    const matchingTrace = traces.find((t) =>
      t.userInput.toLowerCase().includes(tc.userInput.toLowerCase()),
    );

    if (!matchingTrace) {
      results.push({
        testId: tc.id,
        description: tc.description,
        passed: false,
        checks: [
          {
            name: "trace_match",
            status: "fail",
            message: `No trace found matching userInput: "${tc.userInput}"`,
          },
        ],
      });
      continue;
    }

    results.push(evaluateTrace(tc, matchingTrace));
  }

  return {
    totalTests: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
    timestamp: new Date(),
  };
}

/**
 * Format an eval report as a human-readable string.
 */
export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`\n${"═".repeat(60)}`);
  lines.push(`  Trajectory Evaluation Report`);
  lines.push(`  ${report.timestamp.toISOString()}`);
  lines.push(`${"═".repeat(60)}`);
  lines.push(
    `  Total: ${report.totalTests}  Passed: ${report.passed}  Failed: ${report.failed}`,
  );
  lines.push(`${"─".repeat(60)}`);

  for (const result of report.results) {
    const icon = result.passed ? "✓" : "✗";
    lines.push(`\n  ${icon} [${result.testId}] ${result.description}`);
    if (result.traceId) lines.push(`    trace: ${result.traceId}`);

    for (const check of result.checks) {
      const checkIcon =
        check.status === "pass" ? "  ✓" : check.status === "fail" ? "  ✗" : "  -";
      lines.push(`    ${checkIcon} ${check.name}: ${check.message ?? ""}`);
    }
  }

  lines.push(`\n${"═".repeat(60)}\n`);
  return lines.join("\n");
}

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

type CheckStatus = "pass" | "fail" | "skip";

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

export interface TraceQualityOptions {
  maxLlmCalls?: number;
  maxToolCalls?: number;
  maxTokensIn?: number;
  maxDurationMs?: number;
  maxNetworkExecuteCodeCalls?: number;
  maxWebResearchToolCalls?: number;
  maxOverflowFileReadCalls?: number;
  minObservationSavingsRate?: number;
  maxObservationFullReads?: number;
  minObservationsCreated?: number;
  minCacheReadRate?: number;
  forbidOverflowFullRead?: boolean;
  failOnZeroScoreCommentsAfterRss?: boolean;
}

export interface TraceQualityResult {
  passed: boolean;
  score: number;
  checks: CheckResult[];
  metrics: {
    llmCalls: number;
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
    cacheReadRate: number;
    overflowFullReads: number;
    networkExecuteCodeCalls: number;
    webResearchToolCalls: number;
    overflowFileReadCalls: number;
    observationsCreated: number;
    observationReadCalls: number;
    observationFullReads: number;
    rawChars: number;
    promptChars: number;
    savedChars: number;
    observationSavingsRate: number;
  };
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

function getSteps(trace: Trace): TraceStep[] {
  return typeof trace.steps === "string" ? JSON.parse(trace.steps) : trace.steps;
}

function stepText(step: TraceStep | undefined): string {
  if (!step) return "";
  const content = step.content;
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(step);
  } catch {
    return String(content ?? "");
  }
}

interface ObservationStats {
  observationId?: string;
  rawChars: number;
  promptChars: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return 0;
}

function observationStatsFromRecord(
  record: Record<string, unknown>,
): ObservationStats | undefined {
  const nested = isRecord(record.observation) ? record.observation : {};
  const observationId =
    typeof record.observationId === "string"
      ? record.observationId
      : typeof nested.id === "string"
        ? nested.id
        : undefined;

  if (!observationId && !isRecord(record.observation)) return undefined;

  return {
    observationId,
    rawChars: firstFiniteNumber(record.rawChars, nested.rawChars),
    promptChars: firstFiniteNumber(record.promptChars, nested.promptChars),
  };
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function observationStatsFromText(text: string): ObservationStats | undefined {
  const parsed = parseJsonRecord(text);
  if (parsed) return observationStatsFromRecord(parsed);

  const observationId =
    text.match(/"observationId"\s*:\s*"([^"]+)"/)?.[1] ??
    text.match(/\bobservationId\b\s*[:=]\s*([A-Za-z0-9_.:-]+)/)?.[1];
  if (!observationId) return undefined;

  const rawChars = Number(text.match(/\brawChars\b\s*[:=]\s*(\d+)/)?.[1] ?? 0);
  const promptChars = Number(
    text.match(/\bpromptChars\b\s*[:=]\s*(\d+)/)?.[1] ?? 0,
  );

  return {
    observationId,
    rawChars,
    promptChars,
  };
}

function observationStatsFromStep(step: TraceStep): ObservationStats | undefined {
  const metadata = step.metadata;
  if (isRecord(metadata)) {
    const fromMetadata = observationStatsFromRecord(metadata);
    if (fromMetadata) return fromMetadata;
  }

  const content = step.content;
  if (typeof content === "string") return observationStatsFromText(content);
  if (isRecord(content)) return observationStatsFromRecord(content);
  return undefined;
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
  const toolCalls = extractToolCalls(getSteps(trace));
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
 * Score a trace for runtime efficiency and factual hygiene.
 *
 * This is deliberately deterministic so bad production traces can be promoted
 * into regression fixtures without involving another model.
 */
export function evaluateTraceQuality(
  trace: Trace,
  options: TraceQualityOptions = {},
): TraceQualityResult {
  const steps = getSteps(trace);
  const checks: CheckResult[] = [];
  const llmCalls = steps.filter((s) => s.type === "llm_call").length;
  const toolCalls = steps.filter((s) => s.type === "tool_call").length;
  const cacheReadRate =
    trace.tokensIn > 0 ? (trace.cacheReadTokens ?? 0) / trace.tokensIn : 0;

  let overflowFullReads = 0;
  let fabricatedRedditCounts = false;
  let networkExecuteCodeCalls = 0;
  let webResearchToolCalls = 0;
  let overflowFileReadCalls = 0;
  let observationReadCalls = 0;
  let observationFullReads = 0;
  let rawChars = 0;
  let promptChars = 0;
  const observationsCreated = new Set<string>();
  const completionContracts = steps.filter(
    (step) => step.type === "completion_contract",
  );
  const hasVerifiedSendEffect = steps.some((step) => {
    if (step.type !== "tool_result" || !isRecord(step.effect)) return false;
    return step.effect.kind === "send" && step.effect.verified !== false;
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === "tool_result") {
      const observation = observationStatsFromStep(step);
      if (observation) {
        observationsCreated.add(
          observation.observationId ?? `anonymous:${i}`,
        );
        rawChars += observation.rawChars;
        promptChars += observation.promptChars;
      }
      continue;
    }

    if (step.type !== "tool_call") continue;

    const name = step.name;
    const input = step.input as Record<string, unknown> | undefined;
    const code = typeof input?.code === "string" ? input.code : "";
    const next = steps[i + 1];
    const nextText = stepText(next);
    const nextIsBudgetBlocked =
      next?.type === "tool_result" &&
      next.isError === true &&
      /Research budget is exhausted|You already (made|ran|read)|limit reached|You have called .*limit/i.test(
        nextText,
      );
    const normalizedPath =
      typeof input?.path === "string" ? input.path.replace(/\\/g, "/") : "";

    if (name === "observation_read") {
      observationReadCalls++;
      const hasBoundedRead =
        finiteNumber(input?.offset) !== undefined &&
        finiteNumber(input?.length) !== undefined &&
        finiteNumber(input?.length)! > 0;
      if (!hasBoundedRead || nextText.length > 2_500) {
        observationFullReads++;
      }
    }

    if (
      (name === "web_search" || name === "web_fetch") &&
      !nextIsBudgetBlocked
    ) {
      webResearchToolCalls++;
    }

    if (
      name === "execute_code" &&
      /\bweb_(?:search|fetch)\s*\(/.test(code) &&
      !nextIsBudgetBlocked
    ) {
      networkExecuteCodeCalls++;
    }

    if (
      options.forbidOverflowFullRead &&
      name === "file_read" &&
      normalizedPath.includes("/overflow_") &&
      next?.type === "tool_result" &&
      nextText.length > 2_500
    ) {
      overflowFullReads++;
    }

    if (
      name === "file_read" &&
      normalizedPath.includes("/overflow_") &&
      !nextIsBudgetBlocked
    ) {
      overflowFileReadCalls++;
    }

    if (
      options.failOnZeroScoreCommentsAfterRss &&
      name === "execute_code" &&
      /"score"\s*:\s*0/.test(nextText) &&
      /"comments"\s*:\s*0/.test(nextText) &&
      !/missingFields|unavailable|not provided|RSS/i.test(nextText)
    ) {
      fabricatedRedditCounts = true;
    }
  }

  const addThresholdCheck = (
    name: string,
    actual: number,
    limit: number | undefined,
    unit = "",
  ) => {
    if (limit === undefined) return;
    const passed = actual <= limit;
    checks.push({
      name,
      status: passed ? "pass" : "fail",
      message: passed
        ? `${actual}${unit} within limit ${limit}${unit}`
        : `${actual}${unit} exceeds limit ${limit}${unit}`,
    });
  };

  addThresholdCheck("llm_calls", llmCalls, options.maxLlmCalls);
  addThresholdCheck("tool_calls", toolCalls, options.maxToolCalls);
  addThresholdCheck("tokens_in", trace.tokensIn, options.maxTokensIn);
  addThresholdCheck("duration", trace.durationMs, options.maxDurationMs, "ms");
  addThresholdCheck(
    "network_execute_code_calls",
    networkExecuteCodeCalls,
    options.maxNetworkExecuteCodeCalls,
  );
  addThresholdCheck(
    "web_research_tool_calls",
    webResearchToolCalls,
    options.maxWebResearchToolCalls,
  );
  addThresholdCheck(
    "overflow_file_read_calls",
    overflowFileReadCalls,
    options.maxOverflowFileReadCalls,
  );
  addThresholdCheck(
    "observation_full_reads",
    observationFullReads,
    options.maxObservationFullReads,
  );

  for (const contract of completionContracts) {
    if (contract.requiresFileDelivery !== true) continue;
    const satisfied = contract.satisfied === true || hasVerifiedSendEffect;
    checks.push({
      name: "completion_contract",
      status: satisfied ? "pass" : "fail",
      message: satisfied
        ? "File-delivery completion contract satisfied"
        : "File-delivery completion contract was not satisfied",
    });
  }

  if (options.minCacheReadRate !== undefined) {
    const passed = cacheReadRate >= options.minCacheReadRate;
    checks.push({
      name: "cache_read_rate",
      status: passed ? "pass" : "fail",
      message: `${Math.round(cacheReadRate * 100)}% cache read rate`,
    });
  }

  const savedChars = Math.max(0, rawChars - promptChars);
  const observationSavingsRate = rawChars > 0 ? savedChars / rawChars : 0;

  if (options.minObservationSavingsRate !== undefined) {
    const passed = observationSavingsRate >= options.minObservationSavingsRate;
    checks.push({
      name: "observation_savings_rate",
      status: passed ? "pass" : "fail",
      message: `${Math.round(observationSavingsRate * 100)}% observation savings rate`,
    });
  }

  if (options.minObservationsCreated !== undefined) {
    const actual = observationsCreated.size;
    const passed = actual >= options.minObservationsCreated;
    checks.push({
      name: "observations_created",
      status: passed ? "pass" : "fail",
      message: passed
        ? `${actual} observation(s) meets minimum ${options.minObservationsCreated}`
        : `${actual} observation(s) below minimum ${options.minObservationsCreated}`,
    });
  }

  if (options.forbidOverflowFullRead) {
    checks.push({
      name: "overflow_full_read",
      status: overflowFullReads === 0 ? "pass" : "fail",
      message:
        overflowFullReads === 0
          ? "No full overflow file reads"
          : `${overflowFullReads} full overflow file read(s) pushed back into context`,
    });
  }

  if (options.failOnZeroScoreCommentsAfterRss) {
    checks.push({
      name: "fabricated_reddit_counts",
      status: fabricatedRedditCounts ? "fail" : "pass",
      message: fabricatedRedditCounts
        ? "Reddit score/comments were emitted as 0 without an explicit missing-field marker"
        : "No fabricated Reddit score/comment fields detected",
    });
  }

  let score = 100;
  for (const check of checks) {
    if (check.status === "fail") score -= 15;
  }
  score = Math.max(0, score);

  return {
    passed: checks.every((c) => c.status !== "fail"),
    score,
    checks,
    metrics: {
      llmCalls,
      toolCalls,
      tokensIn: trace.tokensIn,
      tokensOut: trace.tokensOut,
      durationMs: trace.durationMs,
      cacheReadRate,
      overflowFullReads,
      networkExecuteCodeCalls,
      webResearchToolCalls,
      overflowFileReadCalls,
      observationsCreated: observationsCreated.size,
      observationReadCalls,
      observationFullReads,
      rawChars,
      promptChars,
      savedChars,
      observationSavingsRate,
    },
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

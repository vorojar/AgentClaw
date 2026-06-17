import { describe, it, expect } from "vitest";
import {
  evaluateTrace,
  evaluateBatch,
  formatEvalReport,
  evaluateTraceQuality,
} from "../eval.js";
import type { TrajectoryTestCase } from "../eval.js";
import type { Trace, TraceStep } from "@agentclaw/types";

// ── Helper: build a trace ──

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    id: "trace-001",
    conversationId: "conv-001",
    userInput: "help me fix the login bug",
    steps: [
      { type: "llm_call", iteration: 0, tokensIn: 100, tokensOut: 50 },
      {
        type: "tool_call",
        name: "file_read",
        input: { path: "/src/auth.ts" },
      },
      {
        type: "tool_result",
        name: "file_read",
        content: "export function login() { ... }",
        isError: false,
        durationMs: 15,
      },
      { type: "llm_call", iteration: 1, tokensIn: 200, tokensOut: 100 },
      {
        type: "tool_call",
        name: "file_edit",
        input: { path: "/src/auth.ts", old_string: "bug", new_string: "fix" },
      },
      {
        type: "tool_result",
        name: "file_edit",
        content: "File edited successfully",
        isError: false,
        durationMs: 8,
      },
    ],
    response: "I've fixed the login bug by correcting the auth logic.",
    model: "claude-sonnet-4-20250514",
    tokensIn: 300,
    tokensOut: 150,
    durationMs: 2500,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ──

describe("evaluateTrace", () => {
  describe("Tool selection", () => {
    it("should pass when expected tools are found in order", () => {
      const testCase: TrajectoryTestCase = {
        id: "t1",
        description: "Should read then edit file",
        userInput: "fix the login bug",
        expectedTools: [{ name: "file_read" }, { name: "file_edit" }],
      };

      const result = evaluateTrace(testCase, makeTrace());
      expect(result.passed).toBe(true);

      const check = result.checks.find((c) => c.name === "tool_selection");
      expect(check?.status).toBe("pass");
    });

    it("should fail when expected tool is missing", () => {
      const testCase: TrajectoryTestCase = {
        id: "t2",
        description: "Should use grep",
        userInput: "fix the login bug",
        expectedTools: [{ name: "grep" }, { name: "file_edit" }],
      };

      const result = evaluateTrace(testCase, makeTrace());
      expect(result.passed).toBe(false);

      const check = result.checks.find((c) => c.name === "tool_selection");
      expect(check?.status).toBe("fail");
      expect(check?.message).toContain("grep");
    });

    it("should fail when tools are in wrong order", () => {
      const testCase: TrajectoryTestCase = {
        id: "t3",
        description: "Wrong order",
        userInput: "fix the login bug",
        expectedTools: [{ name: "file_edit" }, { name: "file_read" }],
      };

      const result = evaluateTrace(testCase, makeTrace());
      // file_edit found at index 1, then file_read not found after index 1
      const check = result.checks.find((c) => c.name === "tool_selection");
      expect(check?.status).toBe("fail");
    });
  });

  describe("Parameter correctness", () => {
    it("should pass when expected params are found", () => {
      const testCase: TrajectoryTestCase = {
        id: "t4",
        description: "Check file_read path",
        userInput: "fix the login bug",
        expectedTools: [
          {
            name: "file_read",
            inputContains: { path: "/src/auth.ts" },
          },
        ],
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "params:file_read",
      );
      expect(check?.status).toBe("pass");
    });

    it("should fail when expected param value differs", () => {
      const testCase: TrajectoryTestCase = {
        id: "t5",
        description: "Wrong path",
        userInput: "fix the login bug",
        expectedTools: [
          {
            name: "file_read",
            inputContains: { path: "/src/wrong.ts" },
          },
        ],
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "params:file_read",
      );
      expect(check?.status).toBe("fail");
    });

    it("should support substring matching for string params", () => {
      const testCase: TrajectoryTestCase = {
        id: "t6",
        description: "Partial path match",
        userInput: "fix the login bug",
        expectedTools: [
          {
            name: "file_read",
            inputContains: { path: "auth.ts" },
          },
        ],
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "params:file_read",
      );
      expect(check?.status).toBe("pass");
    });
  });

  describe("Error expectations", () => {
    it("should pass when error status matches", () => {
      const testCase: TrajectoryTestCase = {
        id: "t7",
        description: "file_read should succeed",
        userInput: "fix the login bug",
        expectedTools: [
          { name: "file_read", expectError: false },
        ],
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "error:file_read",
      );
      expect(check?.status).toBe("pass");
    });

    it("should fail when error status differs", () => {
      const testCase: TrajectoryTestCase = {
        id: "t8",
        description: "file_read should fail (but it didn't)",
        userInput: "fix the login bug",
        expectedTools: [
          { name: "file_read", expectError: true },
        ],
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "error:file_read",
      );
      expect(check?.status).toBe("fail");
    });
  });

  describe("Forbidden tools", () => {
    it("should pass when no forbidden tools are called", () => {
      const testCase: TrajectoryTestCase = {
        id: "t9",
        description: "Should not call bash",
        userInput: "fix the login bug",
        expectedTools: [],
        forbiddenTools: ["bash", "web_fetch"],
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "forbidden_tools",
      );
      expect(check?.status).toBe("pass");
    });

    it("should fail when forbidden tool is called", () => {
      const testCase: TrajectoryTestCase = {
        id: "t10",
        description: "Should not call file_read",
        userInput: "fix the login bug",
        expectedTools: [],
        forbiddenTools: ["file_read"],
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "forbidden_tools",
      );
      expect(check?.status).toBe("fail");
    });
  });

  describe("Response content", () => {
    it("should pass when response contains expected text", () => {
      const testCase: TrajectoryTestCase = {
        id: "t11",
        description: "Response mentions fix",
        userInput: "fix the login bug",
        expectedTools: [],
        responseContains: "fixed.*login",
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "response_contains",
      );
      expect(check?.status).toBe("pass");
    });

    it("should fail when response missing expected text", () => {
      const testCase: TrajectoryTestCase = {
        id: "t12",
        description: "Response should mention database",
        userInput: "fix the login bug",
        expectedTools: [],
        responseContains: "database",
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "response_contains",
      );
      expect(check?.status).toBe("fail");
    });

    it("should pass when response does NOT contain forbidden text", () => {
      const testCase: TrajectoryTestCase = {
        id: "t13",
        description: "Response should not contain error",
        userInput: "fix the login bug",
        expectedTools: [],
        responseNotContains: "error|failed",
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find(
        (c) => c.name === "response_not_contains",
      );
      expect(check?.status).toBe("pass");
    });
  });

  describe("Model and duration", () => {
    it("should check model name", () => {
      const testCase: TrajectoryTestCase = {
        id: "t14",
        description: "Should use sonnet",
        userInput: "fix the login bug",
        expectedTools: [],
        expectedModel: "claude-sonnet-4-20250514",
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find((c) => c.name === "model");
      expect(check?.status).toBe("pass");
    });

    it("should check duration limit", () => {
      const testCase: TrajectoryTestCase = {
        id: "t15",
        description: "Should complete within 5s",
        userInput: "fix the login bug",
        expectedTools: [],
        maxDurationMs: 5000,
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find((c) => c.name === "duration");
      expect(check?.status).toBe("pass");
    });

    it("should fail when duration exceeds limit", () => {
      const testCase: TrajectoryTestCase = {
        id: "t16",
        description: "Should complete within 1s",
        userInput: "fix the login bug",
        expectedTools: [],
        maxDurationMs: 1000,
      };

      const result = evaluateTrace(testCase, makeTrace());
      const check = result.checks.find((c) => c.name === "duration");
      expect(check?.status).toBe("fail");
    });
  });
});

describe("evaluateTraceQuality", () => {
  it("calculates observation savings from tool result metadata", () => {
    const result = evaluateTraceQuality(
      makeTrace({
        id: "observation-metadata-trace",
        steps: [
          { type: "llm_call", iteration: 1, tokensIn: 8_000, tokensOut: 200 },
          { type: "tool_call", name: "execute_code", input: { code: "collect large report" } },
          {
            type: "tool_result",
            name: "execute_code",
            content: "Observation stored: obs-001",
            metadata: {
              observationId: "obs-001",
              observation: {
                rawChars: 12_000,
                promptChars: 900,
              },
            },
            isError: false,
            durationMs: 500,
          },
          { type: "tool_call", name: "observation_read", input: { observationId: "obs-001", offset: 0, length: 500 } },
          {
            type: "tool_result",
            name: "observation_read",
            content: "summary slice",
            isError: false,
            durationMs: 10,
          },
        ],
      }),
      {
        minObservationsCreated: 1,
        minObservationSavingsRate: 0.9,
        maxObservationFullReads: 0,
      },
    );

    expect(result.passed).toBe(true);
    expect(result.metrics.observationsCreated).toBe(1);
    expect(result.metrics.observationReadCalls).toBe(1);
    expect(result.metrics.observationFullReads).toBe(0);
    expect(result.metrics.rawChars).toBe(12_000);
    expect(result.metrics.promptChars).toBe(900);
    expect(result.metrics.savedChars).toBe(11_100);
    expect(result.metrics.observationSavingsRate).toBeCloseTo(0.925);
    expect(result.checks.find((c) => c.name === "observation_savings_rate")?.status).toBe("pass");
  });

  it("detects observation metadata from JSON tool result content", () => {
    const result = evaluateTraceQuality(
      makeTrace({
        id: "observation-content-trace",
        steps: [
          { type: "llm_call", iteration: 1, tokensIn: 4_000, tokensOut: 100 },
          { type: "tool_call", name: "web_fetch", input: { url: "https://example.com/large" } },
          {
            type: "tool_result",
            name: "web_fetch",
            content: JSON.stringify({
              observationId: "obs-content-1",
              observation: {
                rawChars: 5_000,
                promptChars: 1_000,
              },
            }),
            isError: false,
            durationMs: 100,
          },
        ],
      }),
    );

    expect(result.metrics.observationsCreated).toBe(1);
    expect(result.metrics.rawChars).toBe(5_000);
    expect(result.metrics.promptChars).toBe(1_000);
    expect(result.metrics.savedChars).toBe(4_000);
    expect(result.metrics.observationSavingsRate).toBe(0.8);
  });

  it("counts unbounded or oversized observation reads as full reads", () => {
    const result = evaluateTraceQuality(
      makeTrace({
        id: "observation-full-read-trace",
        steps: [
          { type: "llm_call", iteration: 1, tokensIn: 5_000, tokensOut: 100 },
          { type: "tool_call", name: "observation_read", input: { observationId: "obs-001" } },
          {
            type: "tool_result",
            name: "observation_read",
            content: "short full result",
            isError: false,
            durationMs: 10,
          },
          { type: "tool_call", name: "observation_read", input: { observationId: "obs-002", offset: 0, length: 200 } },
          {
            type: "tool_result",
            name: "observation_read",
            content: "x".repeat(4_000),
            isError: false,
            durationMs: 10,
          },
        ],
      }),
      { maxObservationFullReads: 0 },
    );

    expect(result.passed).toBe(false);
    expect(result.metrics.observationReadCalls).toBe(2);
    expect(result.metrics.observationFullReads).toBe(2);
    expect(result.checks.find((c) => c.name === "observation_full_reads")?.status).toBe("fail");
  });

  it("deducts score when observation thresholds fail", () => {
    const result = evaluateTraceQuality(
      makeTrace({
        id: "observation-threshold-failure",
        steps: [
          { type: "llm_call", iteration: 1, tokensIn: 3_000, tokensOut: 100 },
          { type: "tool_call", name: "execute_code", input: { code: "store small payload" } },
          {
            type: "tool_result",
            name: "execute_code",
            content: JSON.stringify({
              observationId: "obs-low-savings",
              rawChars: 1_000,
              promptChars: 900,
            }),
            isError: false,
            durationMs: 100,
          },
        ],
      }),
      {
        minObservationsCreated: 2,
        minObservationSavingsRate: 0.5,
      },
    );

    expect(result.passed).toBe(false);
    expect(result.score).toBe(70);
    expect(result.checks.find((c) => c.name === "observations_created")?.status).toBe("fail");
    expect(result.checks.find((c) => c.name === "observation_savings_rate")?.status).toBe("fail");
  });

  it("fails a news trace that rereads overflow, burns tokens, and fabricates unavailable counts", () => {
    const trace = makeTrace({
      id: "bad-news-trace",
      userInput: "生成 Reddit 科技 AI 日报",
      tokensIn: 66_118,
      tokensOut: 4_617,
      cacheReadTokens: 43_328,
      durationMs: 78_245,
      steps: [
        { type: "llm_call", iteration: 1, tokensIn: 10_171, tokensOut: 505 },
        { type: "tool_call", name: "execute_code", input: { code: "fetch reddit json" } },
        {
          type: "tool_result",
          name: "execute_code",
          content: "Unexpected non-whitespace character after JSON",
          isError: false,
          durationMs: 1706,
        },
        { type: "llm_call", iteration: 2, tokensIn: 10_995, tokensOut: 634 },
        { type: "tool_call", name: "execute_code", input: { code: "fetch reddit rss" } },
        {
          type: "tool_result",
          name: "execute_code",
          content:
            '{"technology":{"posts":[{"title":"A","score":0,"comments":0}]}}',
          isError: false,
          durationMs: 1733,
        },
        { type: "llm_call", iteration: 3, tokensIn: 12_071, tokensOut: 99 },
        {
          type: "tool_call",
          name: "file_read",
          input: { path: "D:/tmp/overflow_execute_code_1.txt" },
        },
        {
          type: "tool_result",
          name: "file_read",
          content: "x".repeat(12_000),
          isError: false,
          durationMs: 5,
        },
        { type: "llm_call", iteration: 4, tokensIn: 15_163, tokensOut: 3269 },
        { type: "llm_call", iteration: 5, tokensIn: 17_718, tokensOut: 110 },
      ],
    });

    const result = evaluateTraceQuality(trace, {
      maxLlmCalls: 3,
      maxTokensIn: 40_000,
      forbidOverflowFullRead: true,
      failOnZeroScoreCommentsAfterRss: true,
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(70);
    expect(result.checks.find((c) => c.name === "llm_calls")?.status).toBe("fail");
    expect(result.checks.find((c) => c.name === "tokens_in")?.status).toBe("fail");
    expect(result.checks.find((c) => c.name === "overflow_full_read")?.status).toBe("fail");
    expect(result.checks.find((c) => c.name === "fabricated_reddit_counts")?.status).toBe("fail");
  });

  it("passes a compact batched news trace with explicit missing count fields", () => {
    const trace = makeTrace({
      id: "good-news-trace",
      userInput: "生成 Reddit 科技 AI 日报",
      tokensIn: 24_000,
      tokensOut: 1_500,
      cacheReadTokens: 17_000,
      durationMs: 22_000,
      steps: [
        { type: "llm_call", iteration: 1, tokensIn: 10_000, tokensOut: 300 },
        { type: "tool_call", name: "execute_code", input: { code: "fetch and reduce" } },
        {
          type: "tool_result",
          name: "execute_code",
          content:
            '{"items":[{"title":"A","score":null,"comments":null}],"missingFields":["reddit_rss_score","reddit_rss_comments"],"readyToWrite":true}',
          isError: false,
          durationMs: 2500,
        },
        { type: "llm_call", iteration: 2, tokensIn: 14_000, tokensOut: 1200 },
      ],
    });

    const result = evaluateTraceQuality(trace, {
      maxLlmCalls: 3,
      maxTokensIn: 40_000,
      forbidOverflowFullRead: true,
      failOnZeroScoreCommentsAfterRss: true,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("fails traces that repeatedly run network execute_code batches", () => {
    const steps: TraceStep[] = [
      { type: "llm_call", iteration: 1, tokensIn: 10_000, tokensOut: 200 },
      { type: "tool_call", name: "execute_code", input: { code: "await web_search('ai news')" } },
      { type: "tool_result", name: "execute_code", content: "results A", isError: false, durationMs: 1000 },
      { type: "llm_call", iteration: 2, tokensIn: 11_000, tokensOut: 200 },
      { type: "tool_call", name: "execute_code", input: { code: "await web_fetch(url)" } },
      { type: "tool_result", name: "execute_code", content: "results B", isError: false, durationMs: 1000 },
      { type: "llm_call", iteration: 3, tokensIn: 12_000, tokensOut: 200 },
      { type: "tool_call", name: "execute_code", input: { code: "await web_search('more ai news')" } },
      { type: "tool_result", name: "execute_code", content: "results C", isError: false, durationMs: 1000 },
      { type: "llm_call", iteration: 4, tokensIn: 13_000, tokensOut: 200 },
      { type: "tool_call", name: "execute_code", input: { code: "await web_fetch(anotherUrl)" } },
      { type: "tool_result", name: "execute_code", content: "results D", isError: false, durationMs: 1000 },
    ];

    const result = evaluateTraceQuality(
      makeTrace({
        id: "serial-network-execute-code",
        userInput: "在外网搜索今日AI界新闻生成简报",
        tokensIn: 46_000,
        tokensOut: 800,
        cacheReadTokens: 20_000,
        durationMs: 40_000,
        steps,
      }),
      { maxNetworkExecuteCodeCalls: 3 },
    );

    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "network_execute_code_calls")?.status).toBe("fail");
    expect(result.metrics.networkExecuteCodeCalls).toBe(4);
  });

  it("fails traces that mix too many web research calls and overflow reads", () => {
    const steps: TraceStep[] = [
      { type: "llm_call", iteration: 1, tokensIn: 10_000, tokensOut: 100 },
      { type: "tool_call", name: "web_search", input: { query: "ai news 1" } },
      { type: "tool_result", name: "web_search", content: "result", isError: false, durationMs: 100 },
      { type: "tool_call", name: "web_search", input: { query: "ai news 2" } },
      { type: "tool_result", name: "web_search", content: "result", isError: false, durationMs: 100 },
      { type: "tool_call", name: "web_search", input: { query: "ai news 3" } },
      { type: "tool_result", name: "web_search", content: "result", isError: false, durationMs: 100 },
      { type: "tool_call", name: "web_fetch", input: { url: "https://example.com/1" } },
      { type: "tool_result", name: "web_fetch", content: "result", isError: false, durationMs: 100 },
      { type: "tool_call", name: "web_fetch", input: { url: "https://example.com/2" } },
      { type: "tool_result", name: "web_fetch", content: "result", isError: false, durationMs: 100 },
      { type: "tool_call", name: "web_fetch", input: { url: "https://example.com/3" } },
      { type: "tool_result", name: "web_fetch", content: "result", isError: false, durationMs: 100 },
      { type: "tool_call", name: "web_search", input: { query: "ai news 4" } },
      { type: "tool_result", name: "web_search", content: "result", isError: false, durationMs: 100 },
      { type: "tool_call", name: "file_read", input: { path: "D:/tmp/overflow_web_fetch_1.txt" } },
      { type: "tool_result", name: "file_read", content: "x".repeat(1500), isError: false, durationMs: 1 },
      { type: "tool_call", name: "file_read", input: { path: "D:/tmp/overflow_execute_code_1.txt", offset: 0, length: 4000 } },
      { type: "tool_result", name: "file_read", content: "x".repeat(4000), isError: false, durationMs: 1 },
      { type: "tool_call", name: "file_read", input: { path: "D:/tmp/overflow_execute_code_2.txt", offset: 0, length: 4000 } },
      { type: "tool_result", name: "file_read", content: "x".repeat(4000), isError: false, durationMs: 1 },
    ];

    const result = evaluateTraceQuality(
      makeTrace({
        id: "mixed-web-research-overflow",
        userInput: "在外网搜索今日AI界新闻生成简报",
        tokensIn: 80_000,
        tokensOut: 1_200,
        cacheReadTokens: 50_000,
        durationMs: 70_000,
        steps,
      }),
      {
        maxWebResearchToolCalls: 6,
        maxOverflowFileReadCalls: 2,
      },
    );

    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "web_research_tool_calls")?.status).toBe("fail");
    expect(result.checks.find((c) => c.name === "overflow_file_read_calls")?.status).toBe("fail");
    expect(result.metrics.webResearchToolCalls).toBe(7);
    expect(result.metrics.overflowFileReadCalls).toBe(3);
  });

  it("fails when a file-delivery completion contract is not satisfied", () => {
    const result = evaluateTraceQuality(
      makeTrace({
        userInput: "生成报告并发给我",
        steps: [
          {
            type: "completion_contract",
            requiresFileDelivery: true,
            requiredEffects: ["send_file"],
            satisfied: false,
          },
          { type: "llm_call", iteration: 1, tokensIn: 100, tokensOut: 50 },
        ],
        response: "报告已经生成。",
      }),
    );

    expect(result.passed).toBe(false);
    expect(
      result.checks.find((c) => c.name === "completion_contract")?.status,
    ).toBe("fail");
  });

  it("passes a file-delivery completion contract when send effect exists", () => {
    const result = evaluateTraceQuality(
      makeTrace({
        userInput: "生成报告并发给我",
        steps: [
          {
            type: "completion_contract",
            requiresFileDelivery: true,
            requiredEffects: ["send_file"],
            satisfied: true,
          },
          {
            type: "tool_result",
            name: "send_file",
            content: "sent",
            isError: false,
            effect: {
              kind: "send",
              target: "/files/report.md",
              verified: true,
              metadata: { filename: "report.md" },
            },
          },
        ],
        response: "[report.md](/files/report.md)",
      }),
    );

    expect(
      result.checks.find((c) => c.name === "completion_contract")?.status,
    ).toBe("pass");
  });
});

describe("evaluateBatch", () => {
  it("should match traces by userInput and evaluate", () => {
    const traces = [
      makeTrace({ id: "t-1", userInput: "fix the login bug" }),
      makeTrace({ id: "t-2", userInput: "add a new feature" }),
    ];

    const testCases: TrajectoryTestCase[] = [
      {
        id: "tc1",
        description: "Login fix trajectory",
        userInput: "login bug",
        expectedTools: [{ name: "file_read" }],
      },
      {
        id: "tc2",
        description: "New feature trajectory",
        userInput: "add a new feature",
        expectedTools: [{ name: "file_read" }],
      },
    ];

    const report = evaluateBatch(testCases, traces);

    expect(report.totalTests).toBe(2);
    expect(report.passed).toBe(2);
    expect(report.results[0].traceId).toBe("t-1");
    expect(report.results[1].traceId).toBe("t-2");
  });

  it("should report failure when no matching trace found", () => {
    const testCases: TrajectoryTestCase[] = [
      {
        id: "tc1",
        description: "Nonexistent trace",
        userInput: "something that was never asked",
        expectedTools: [],
      },
    ];

    const report = evaluateBatch(testCases, []);

    expect(report.totalTests).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.results[0].checks[0].name).toBe("trace_match");
  });
});

describe("formatEvalReport", () => {
  it("should produce a readable report", () => {
    const trace = makeTrace();
    const testCase: TrajectoryTestCase = {
      id: "t1",
      description: "Basic check",
      userInput: "fix the login bug",
      expectedTools: [{ name: "file_read" }],
    };

    const result = evaluateTrace(testCase, trace);
    const report = {
      totalTests: 1,
      passed: 1,
      failed: 0,
      results: [result],
      timestamp: new Date("2026-03-12T00:00:00Z"),
    };

    const output = formatEvalReport(report);
    expect(output).toContain("Trajectory Evaluation Report");
    expect(output).toContain("Total: 1");
    expect(output).toContain("Passed: 1");
    expect(output).toContain("✓");
    expect(output).toContain("tool_selection");
  });
});

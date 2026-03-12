import { describe, it, expect } from "vitest";
import {
  evaluateTrace,
  evaluateBatch,
  formatEvalReport,
} from "../eval.js";
import type { TrajectoryTestCase } from "../eval.js";
import type { Trace } from "@agentclaw/types";

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
        description: "Should not call shell",
        userInput: "fix the login bug",
        expectedTools: [],
        forbiddenTools: ["shell", "web_fetch"],
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

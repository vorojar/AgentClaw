import { describe, it, expect, vi } from "vitest";
import { WorkflowRunner } from "../workflow.js";
import type { WorkflowDefinition, Tool, ToolResult } from "@agentclaw/types";

// ── Mock tool factory ──

function createMockTool(
  name: string,
  handler: (input: Record<string, unknown>) => ToolResult | Promise<ToolResult>,
): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    category: "builtin",
    parameters: { type: "object" as const, properties: {} },
    execute: async (input) => handler(input),
  };
}

function createToolMap(...tools: Tool[]): (name: string) => Tool | undefined {
  const map = new Map(tools.map((t) => [t.name, t]));
  return (name: string) => map.get(name);
}

// ── Tests ──

describe("WorkflowRunner", () => {
  describe("Sequential execution", () => {
    it("should execute steps in order", async () => {
      const order: string[] = [];
      const getTool = createToolMap(
        createMockTool("step_a", () => {
          order.push("a");
          return { content: "result_a" };
        }),
        createMockTool("step_b", () => {
          order.push("b");
          return { content: "result_b" };
        }),
        createMockTool("step_c", () => {
          order.push("c");
          return { content: "result_c" };
        }),
      );

      const workflow: WorkflowDefinition = {
        name: "test-seq",
        steps: [
          { id: "s1", type: "tool", toolName: "step_a" },
          { id: "s2", type: "tool", toolName: "step_b" },
          { id: "s3", type: "tool", toolName: "step_c" },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveLength(3);
      expect(order).toEqual(["a", "b", "c"]);
      expect(result.stepResults[0].content).toBe("result_a");
      expect(result.stepResults[1].content).toBe("result_b");
      expect(result.stepResults[2].content).toBe("result_c");
    });

    it("should pass template variables between steps", async () => {
      const getTool = createToolMap(
        createMockTool("fetch_url", () => ({
          content: "https://example.com/data.json",
        })),
        createMockTool("download", (input) => ({
          content: `downloaded: ${input.url}`,
        })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-template",
        steps: [
          { id: "fetch", type: "tool", toolName: "fetch_url" },
          {
            id: "download",
            type: "tool",
            toolName: "download",
            toolInput: { url: "{{fetch.content}}" },
          },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults[1].content).toBe(
        "downloaded: https://example.com/data.json",
      );
    });

    it("should resolve input variables", async () => {
      const getTool = createToolMap(
        createMockTool("greet", (input) => ({
          content: `Hello, ${input.name}!`,
        })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-input",
        steps: [
          {
            id: "g",
            type: "tool",
            toolName: "greet",
            toolInput: { name: "{{input.userName}}" },
          },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow, { userName: "Alice" });

      expect(result.success).toBe(true);
      expect(result.stepResults[0].content).toBe("Hello, Alice!");
    });

    it("should stop on error by default", async () => {
      const getTool = createToolMap(
        createMockTool("fail_tool", () => ({
          content: "something went wrong",
          isError: true,
        })),
        createMockTool("never_reached", () => ({
          content: "should not run",
        })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-error-stop",
        steps: [
          { id: "s1", type: "tool", toolName: "fail_tool" },
          { id: "s2", type: "tool", toolName: "never_reached" },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(false);
      expect(result.stepResults).toHaveLength(1);
      expect(result.error).toContain("s1");
    });

    it("should continue on error when onError=continue", async () => {
      const getTool = createToolMap(
        createMockTool("fail_tool", () => ({
          content: "error occurred",
          isError: true,
        })),
        createMockTool("next_tool", () => ({
          content: "continued",
        })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-error-continue",
        steps: [
          {
            id: "s1",
            type: "tool",
            toolName: "fail_tool",
            onError: "continue",
          },
          { id: "s2", type: "tool", toolName: "next_tool" },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0].isError).toBe(true);
      expect(result.stepResults[1].content).toBe("continued");
    });
  });

  describe("Parallel execution", () => {
    it("should run sub-steps concurrently", async () => {
      const startTimes: number[] = [];

      const getTool = createToolMap(
        createMockTool("slow_a", async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          return { content: "a_done" };
        }),
        createMockTool("slow_b", async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          return { content: "b_done" };
        }),
      );

      const workflow: WorkflowDefinition = {
        name: "test-parallel",
        steps: [
          {
            id: "parallel_block",
            type: "parallel",
            steps: [
              { id: "pa", type: "tool", toolName: "slow_a" },
              { id: "pb", type: "tool", toolName: "slow_b" },
            ],
          },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveLength(2);
      // Both should start within ~10ms of each other (concurrent)
      expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(30);
      expect(result.stepResults.find((r) => r.stepId === "pa")?.content).toBe(
        "a_done",
      );
      expect(result.stepResults.find((r) => r.stepId === "pb")?.content).toBe(
        "b_done",
      );
    });

    it("should combine parallel results with subsequent sequential step", async () => {
      const getTool = createToolMap(
        createMockTool("get_name", () => ({ content: "Alice" })),
        createMockTool("get_age", () => ({ content: "30" })),
        createMockTool("combine", (input) => ({
          content: `${input.name} is ${input.age}`,
        })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-parallel-then-seq",
        steps: [
          {
            id: "gather",
            type: "parallel",
            steps: [
              { id: "name", type: "tool", toolName: "get_name" },
              { id: "age", type: "tool", toolName: "get_age" },
            ],
          },
          {
            id: "merge",
            type: "tool",
            toolName: "combine",
            toolInput: {
              name: "{{name.content}}",
              age: "{{age.content}}",
            },
          },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveLength(3);
      expect(result.stepResults[2].content).toBe("Alice is 30");
    });
  });

  describe("Conditions", () => {
    it("should skip step when condition is false", async () => {
      const getTool = createToolMap(
        createMockTool("check", () => ({ content: "false" })),
        createMockTool("conditional", () => ({
          content: "should not run",
        })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-condition",
        steps: [
          { id: "check", type: "tool", toolName: "check" },
          {
            id: "maybe",
            type: "tool",
            toolName: "conditional",
            condition: "{{check.content}}",
          },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults[1].content).toContain("skipped");
    });

    it("should execute step when condition is truthy", async () => {
      const getTool = createToolMap(
        createMockTool("check", () => ({ content: "yes" })),
        createMockTool("conditional", () => ({
          content: "executed!",
        })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-condition-true",
        steps: [
          { id: "check", type: "tool", toolName: "check" },
          {
            id: "maybe",
            type: "tool",
            toolName: "conditional",
            condition: "{{check.content}}",
          },
        ],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults[1].content).toBe("executed!");
    });
  });

  describe("Edge cases", () => {
    it("should handle missing tool gracefully", async () => {
      const getTool = () => undefined;

      const workflow: WorkflowDefinition = {
        name: "test-missing-tool",
        steps: [{ id: "s1", type: "tool", toolName: "nonexistent" }],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(false);
      expect(result.stepResults[0].isError).toBe(true);
      expect(result.stepResults[0].content).toContain("not found");
    });

    it("should handle tool execution exception", async () => {
      const getTool = createToolMap(
        createMockTool("throw_tool", () => {
          throw new Error("unexpected crash");
        }),
      );

      const workflow: WorkflowDefinition = {
        name: "test-exception",
        steps: [{ id: "s1", type: "tool", toolName: "throw_tool" }],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(false);
      expect(result.stepResults[0].isError).toBe(true);
      expect(result.stepResults[0].content).toContain("unexpected crash");
    });

    it("should handle abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      const getTool = createToolMap(
        createMockTool("tool_a", () => ({ content: "ok" })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-abort",
        steps: [{ id: "s1", type: "tool", toolName: "tool_a" }],
      };

      const runner = new WorkflowRunner({
        getTool,
        abortSignal: controller.signal,
      });
      const result = await runner.run(workflow);

      expect(result.success).toBe(false);
      expect(result.error).toContain("aborted");
      expect(result.stepResults).toHaveLength(0);
    });

    it("should call onStepComplete callback", async () => {
      const completedSteps: string[] = [];
      const getTool = createToolMap(
        createMockTool("tool_a", () => ({ content: "ok" })),
        createMockTool("tool_b", () => ({ content: "ok" })),
      );

      const workflow: WorkflowDefinition = {
        name: "test-callback",
        steps: [
          { id: "s1", type: "tool", toolName: "tool_a" },
          { id: "s2", type: "tool", toolName: "tool_b" },
        ],
      };

      const runner = new WorkflowRunner({
        getTool,
        onStepComplete: (r) => completedSteps.push(r.stepId),
      });
      await runner.run(workflow);

      expect(completedSteps).toEqual(["s1", "s2"]);
    });

    it("should track durationMs for each step", async () => {
      const getTool = createToolMap(
        createMockTool("slow", async () => {
          await new Promise((r) => setTimeout(r, 30));
          return { content: "done" };
        }),
      );

      const workflow: WorkflowDefinition = {
        name: "test-duration",
        steps: [{ id: "s1", type: "tool", toolName: "slow" }],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.stepResults[0].durationMs).toBeGreaterThanOrEqual(25);
    });

    it("should handle empty workflow", async () => {
      const getTool = () => undefined;
      const workflow: WorkflowDefinition = {
        name: "empty",
        steps: [],
      };

      const runner = new WorkflowRunner({ getTool });
      const result = await runner.run(workflow);

      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveLength(0);
    });
  });
});

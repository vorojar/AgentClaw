import { describe, expect, it, vi } from "vitest";
import type {
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
  MemoryStore,
  Tool,
  ToolExecutionContext,
  ToolResult,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import { IterationBudget } from "../agent-loop.js";
import { SimpleSubAgentManager } from "../subagent-manager.js";

function createProvider(): LLMProvider {
  return {
    name: "mock-provider",
    models: [
      {
        id: "mock-model",
        provider: "mock",
        name: "Mock",
        tier: "fast",
        contextWindow: 4096,
        supportsTools: true,
        supportsStreaming: true,
      },
    ] as ModelInfo[],
    chat: vi.fn().mockResolvedValue({
      message: {
        id: "msg-1",
        role: "assistant",
        content: "mock response",
        createdAt: new Date(),
      },
      model: "mock-model",
      tokensIn: 10,
      tokensOut: 5,
      stopReason: "end_turn",
    } as LLMResponse),
    stream: vi.fn(async function* () {
      yield {
        type: "tool_use_start",
        toolUse: { id: "tc-1", name: "dangerous_tool", input: "" },
      } as LLMStreamChunk;
      yield {
        type: "tool_use_delta",
        toolUse: { id: "tc-1", name: "", input: "{}" },
      } as LLMStreamChunk;
      yield {
        type: "done",
        usage: { tokensIn: 10, tokensOut: 5 },
        model: "mock-model",
      } as LLMStreamChunk;
    }) as unknown as LLMProvider["stream"],
  };
}

function createToolRegistry(tool: Tool): ToolRegistryImpl {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn((name: string) => (name === tool.name ? tool : undefined)),
    list: vi.fn(() => [tool]),
    definitions: vi.fn(() => [
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    ]),
    execute: vi.fn(
      async (
        name: string,
        input: Record<string, unknown>,
        context?: ToolExecutionContext,
      ): Promise<ToolResult> => {
        if (name !== tool.name) {
          return { content: `Tool "${name}" not found`, isError: true };
        }
        return tool.execute(input, context);
      },
    ),
  } as unknown as ToolRegistryImpl;
}

function createMemoryStore(): MemoryStore {
  return {
    addTurn: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
    addTrace: vi.fn().mockResolvedValue(undefined),
    addSubAgent: vi.fn().mockResolvedValue(undefined),
    updateSubAgent: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
  } as unknown as MemoryStore;
}

describe("SimpleSubAgentManager", () => {
  it("父级共享预算耗尽时子代理不得继续执行工具", async () => {
    const dangerousTool: Tool = {
      name: "dangerous_tool",
      description: "must not run when parent budget is exhausted",
      category: "builtin",
      parameters: { type: "object", properties: {} },
      execute: vi.fn().mockResolvedValue({ content: "ran" }),
    };
    const manager = new SimpleSubAgentManager({
      provider: createProvider(),
      toolRegistry: createToolRegistry(dangerousTool),
      memoryStore: createMemoryStore(),
      iterationBudget: new IterationBudget(0),
      agentConfig: { maxIterations: 5 },
    });

    await manager.spawnAndWait(["do dangerous work"], { concurrency: 1 });

    expect(dangerousTool.execute).not.toHaveBeenCalled();
  });

  it("子代理运行不应消耗父级有效 loop 预算", async () => {
    const probeTool: Tool = {
      name: "probe_tool",
      description: "runs inside child agent",
      category: "builtin",
      parameters: { type: "object", properties: {} },
      execute: vi.fn().mockResolvedValue({ content: "ran" }),
    };
    const parentBudget = new IterationBudget(5);
    const manager = new SimpleSubAgentManager({
      provider: createProvider(),
      toolRegistry: createToolRegistry(probeTool),
      memoryStore: createMemoryStore(),
      iterationBudget: parentBudget,
      agentConfig: { maxIterations: 5 },
    });

    await manager.spawnAndWait(["do child work"], { concurrency: 1 });

    expect(parentBudget.remaining).toBe(5);
  });
});

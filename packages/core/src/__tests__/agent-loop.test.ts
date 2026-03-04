import { describe, it, expect, vi, beforeEach } from "vitest";
import { SimpleAgentLoop } from "../agent-loop.js";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
  ContextManager,
  MemoryStore,
  Message,
  AgentEvent,
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  ContentBlock,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";

// ── Mock 工厂：创建假 LLMProvider ──

function createMockProvider(
  streamChunks: LLMStreamChunk[][] = [],
): LLMProvider {
  let callIndex = 0;
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
    stream: vi.fn(function* () {
      const chunks = streamChunks[callIndex] ?? [];
      callIndex++;
      for (const chunk of chunks) {
        yield chunk;
      }
    }) as unknown as LLMProvider["stream"],
  };
}

// ── Mock ToolRegistryImpl ──

function createMockToolRegistry(tools: Tool[] = []): ToolRegistryImpl {
  const toolMap = new Map<string, Tool>();
  for (const t of tools) toolMap.set(t.name, t);

  return {
    register: vi.fn((tool: Tool) => toolMap.set(tool.name, tool)),
    unregister: vi.fn((name: string) => toolMap.delete(name)),
    get: vi.fn((name: string) => toolMap.get(name)),
    list: vi.fn(() => Array.from(toolMap.values())),
    definitions: vi.fn(() =>
      Array.from(toolMap.values()).map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      })),
    ),
    execute: vi.fn(
      async (
        name: string,
        input: Record<string, unknown>,
        context?: ToolExecutionContext,
      ): Promise<ToolResult> => {
        const tool = toolMap.get(name);
        if (!tool)
          return { content: `Tool "${name}" not found`, isError: true };
        return tool.execute(input, context);
      },
    ),
  } as unknown as ToolRegistryImpl;
}

// ── Mock ContextManager ──

function createMockContextManager(
  systemPrompt = "你是一个测试助手。",
): ContextManager {
  return {
    buildContext: vi.fn().mockResolvedValue({
      systemPrompt,
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: new Date(),
        },
      ] as Message[],
    }),
  };
}

// ── Mock MemoryStore（最小实现） ──

function createMockMemoryStore(): MemoryStore {
  return {
    add: vi.fn().mockResolvedValue({
      id: "mem-1",
      type: "fact",
      content: "",
      importance: 0.5,
      createdAt: new Date(),
      accessedAt: new Date(),
      accessCount: 0,
    }),
    search: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({}),
    findSimilar: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    addTurn: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
    saveSession: vi.fn().mockResolvedValue(undefined),
    getSessionById: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    addTrace: vi.fn().mockResolvedValue(undefined),
    getTrace: vi.fn().mockResolvedValue(null),
    getTraces: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  } as unknown as MemoryStore;
}

// ── 辅助函数：收集 async iterable 中的所有事件 ──

async function collectEvents(
  iterable: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

// ── 创建一个简单的 mock Tool ──

function createMockTool(
  name: string,
  result: ToolResult = { content: "ok" },
): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    category: "builtin",
    parameters: {
      type: "object" as const,
      properties: {
        input: { type: "string" },
      },
    },
    execute: vi.fn().mockResolvedValue(result),
  };
}

describe("SimpleAgentLoop", () => {
  let provider: LLMProvider;
  let toolRegistry: ToolRegistryImpl;
  let contextManager: ContextManager;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    // 默认：LLM 返回纯文本回复（无工具调用），直接结束
    provider = createMockProvider([
      [
        { type: "text", text: "你好，我是测试助手！" },
        {
          type: "done",
          usage: { tokensIn: 50, tokensOut: 20 },
          model: "mock-model",
        },
      ],
    ]);
    toolRegistry = createMockToolRegistry();
    contextManager = createMockContextManager();
    memoryStore = createMockMemoryStore();
  });

  // ── 构造和配置测试 ──

  describe("构造和基本配置", () => {
    it("应使用默认配置创建实例", () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      expect(loop.state).toBe("idle");
      expect(loop.config.maxIterations).toBe(15);
      expect(loop.config.temperature).toBe(0.5);
      expect(loop.config.maxTokens).toBe(8192);
      expect(loop.config.streaming).toBe(false);
    });

    it("应允许通过 config 参数覆盖默认值", () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
        config: {
          maxIterations: 5,
          temperature: 0.8,
          maxTokens: 4096,
          model: "custom-model",
        },
      });

      expect(loop.config.maxIterations).toBe(5);
      expect(loop.config.temperature).toBe(0.8);
      expect(loop.config.maxTokens).toBe(4096);
      expect(loop.config.model).toBe("custom-model");
      // 未覆盖的字段保持默认值
      expect(loop.config.systemPrompt).toBe("");
    });
  });

  // ── 简单文本回复测试 ──

  describe("纯文本回复流程", () => {
    it("应在无工具调用时产生 thinking + response_chunk + response_complete 事件", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(loop.runStream("hello", "conv-1"));

      // 检查事件类型序列
      const types = events.map((e) => e.type);
      expect(types).toContain("thinking");
      expect(types).toContain("response_chunk");
      expect(types).toContain("response_complete");

      // response_complete 应包含完整消息
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(message.role).toBe("assistant");
      expect(message.tokensIn).toBe(50);
      expect(message.tokensOut).toBe(20);
      expect(message.model).toBe("mock-model");
    });

    it("应将用户消息和助手回复存入 memoryStore", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      await collectEvents(loop.runStream("hello", "conv-1"));

      // addTurn 应被调用至少 2 次（用户消息 + 助手消息）
      expect(memoryStore.addTurn).toHaveBeenCalledTimes(2);

      // 第一次调用：存储用户消息
      const firstCall = (memoryStore.addTurn as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(firstCall[0]).toBe("conv-1");
      expect(firstCall[1].role).toBe("user");

      // 第二次调用：存储助手消息
      const secondCall = (memoryStore.addTurn as ReturnType<typeof vi.fn>).mock
        .calls[1];
      expect(secondCall[0]).toBe("conv-1");
      expect(secondCall[1].role).toBe("assistant");
    });

    it("run() 应返回完整的助手消息", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      const message = await loop.run("hello", "conv-1");

      expect(message.role).toBe("assistant");
      expect(message.model).toBe("mock-model");
    });
  });

  // ── maxIterations 限制测试 ──

  describe("maxIterations 限制", () => {
    it("达到 maxIterations 后应停止循环并返回 fallback 消息", async () => {
      // 每次 LLM 调用都返回一个工具调用，强制循环继续
      const toolCallChunks: LLMStreamChunk[] = [
        {
          type: "tool_use_start",
          toolUse: { id: "tc-1", name: "test_tool", input: "" },
        },
        {
          type: "tool_use_delta",
          toolUse: { id: "tc-1", name: "", input: '{"input":"x"}' },
        },
        {
          type: "done",
          usage: { tokensIn: 10, tokensOut: 5 },
          model: "mock-model",
        },
      ];

      // 创建 3 轮一样的工具调用 chunk（maxIterations=3）
      const allChunks = [toolCallChunks, toolCallChunks, toolCallChunks];
      const testProvider = createMockProvider(allChunks);

      const testTool = createMockTool("test_tool", { content: "tool result" });
      const testToolRegistry = createMockToolRegistry([testTool]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream("do something", "conv-2"),
      );

      // 应有 response_complete 事件
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();

      // 工具应被调用 3 次（每次迭代一次）
      expect(testTool.execute).toHaveBeenCalledTimes(3);

      // 循环结束后状态应回到 idle
      expect(loop.state).toBe("idle");

      // trace 应记录 max_iterations_reached 错误
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({ error: "max_iterations_reached" }),
      );
    });
  });

  // ── 工具调用循环测试 ──

  describe("工具调用循环", () => {
    it("应正确执行工具并将结果传回 LLM", async () => {
      // 第 1 轮：LLM 调用工具
      const toolCallChunks: LLMStreamChunk[] = [
        { type: "text", text: "让我搜索一下" },
        {
          type: "tool_use_start",
          toolUse: {
            id: "tc-search",
            name: "web_search",
            input: "",
          },
        },
        {
          type: "tool_use_delta",
          toolUse: {
            id: "tc-search",
            name: "",
            input: '{"query":"test"}',
          },
        },
        {
          type: "done",
          usage: { tokensIn: 30, tokensOut: 15 },
          model: "mock-model",
        },
      ];

      // 第 2 轮：LLM 根据工具结果生成最终回复
      const finalChunks: LLMStreamChunk[] = [
        { type: "text", text: "搜索结果是..." },
        {
          type: "done",
          usage: { tokensIn: 60, tokensOut: 25 },
          model: "mock-model",
        },
      ];

      const testProvider = createMockProvider([toolCallChunks, finalChunks]);

      const searchTool = createMockTool("web_search", {
        content: "搜索结果：找到了 3 个结果",
      });
      const testToolRegistry = createMockToolRegistry([searchTool]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream("搜索一下测试", "conv-3"),
      );

      // 检查事件流中包含工具调用和结果事件
      const types = events.map((e) => e.type);
      expect(types).toContain("tool_call");
      expect(types).toContain("tool_result");
      expect(types).toContain("response_complete");

      // 工具被正确调用
      expect(searchTool.execute).toHaveBeenCalledTimes(1);
      expect(searchTool.execute).toHaveBeenCalledWith(
        { query: "test" },
        undefined, // context
      );

      // tool_result 事件应包含工具名和结果
      const toolResultEvent = events.find((e) => e.type === "tool_result");
      expect(toolResultEvent).toBeDefined();
      const resultData = toolResultEvent!.data as {
        name: string;
        result: ToolResult;
      };
      expect(resultData.name).toBe("web_search");
      expect(resultData.result.content).toBe("搜索结果：找到了 3 个结果");

      // 最终消息应包含累计 token
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(message.tokensIn).toBe(90); // 30 + 60
      expect(message.tokensOut).toBe(40); // 15 + 25
    });

    it("工具执行失败时应记录 isError 并传回 LLM", async () => {
      // 第 1 轮：调用工具
      const toolCallChunks: LLMStreamChunk[] = [
        {
          type: "tool_use_start",
          toolUse: { id: "tc-1", name: "failing_tool", input: "" },
        },
        {
          type: "tool_use_delta",
          toolUse: { id: "tc-1", name: "", input: "{}" },
        },
        {
          type: "done",
          usage: { tokensIn: 10, tokensOut: 5 },
          model: "mock-model",
        },
      ];

      // 第 2 轮：LLM 看到错误后生成解释
      const finalChunks: LLMStreamChunk[] = [
        { type: "text", text: "工具执行失败了" },
        {
          type: "done",
          usage: { tokensIn: 20, tokensOut: 10 },
          model: "mock-model",
        },
      ];

      const testProvider = createMockProvider([toolCallChunks, finalChunks]);

      const failingTool = createMockTool("failing_tool", {
        content: "连接超时",
        isError: true,
      });
      const testToolRegistry = createMockToolRegistry([failingTool]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(loop.runStream("执行一下", "conv-4"));

      // tool_result 事件应标记 isError
      const toolResultEvent = events.find((e) => e.type === "tool_result");
      expect(toolResultEvent).toBeDefined();
      const resultData = toolResultEvent!.data as {
        name: string;
        result: ToolResult;
      };
      expect(resultData.result.isError).toBe(true);
      expect(resultData.result.content).toBe("连接超时");

      // memoryStore 应保存包含错误标记的 tool turn
      const toolTurnCalls = (
        memoryStore.addTurn as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (call: unknown[]) => (call[1] as { role: string }).role === "tool",
      );
      expect(toolTurnCalls.length).toBe(1);
    });

    it("多个并发工具调用应全部执行", async () => {
      // LLM 一次返回两个工具调用
      const toolCallChunks: LLMStreamChunk[] = [
        {
          type: "tool_use_start",
          toolUse: { id: "tc-1", name: "tool_a", input: "" },
        },
        {
          type: "tool_use_delta",
          toolUse: { id: "tc-1", name: "", input: '{"x":1}' },
        },
        {
          type: "tool_use_start",
          toolUse: { id: "tc-2", name: "tool_b", input: "" },
        },
        {
          type: "tool_use_delta",
          toolUse: { id: "tc-2", name: "", input: '{"y":2}' },
        },
        {
          type: "done",
          usage: { tokensIn: 20, tokensOut: 10 },
          model: "mock-model",
        },
      ];

      const finalChunks: LLMStreamChunk[] = [
        { type: "text", text: "两个工具都完成了" },
        {
          type: "done",
          usage: { tokensIn: 40, tokensOut: 15 },
          model: "mock-model",
        },
      ];

      const testProvider = createMockProvider([toolCallChunks, finalChunks]);

      const toolA = createMockTool("tool_a", { content: "result A" });
      const toolB = createMockTool("tool_b", { content: "result B" });
      const testToolRegistry = createMockToolRegistry([toolA, toolB]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(loop.runStream("do both", "conv-5"));

      // 两个工具都应被调用
      expect(toolA.execute).toHaveBeenCalledTimes(1);
      expect(toolB.execute).toHaveBeenCalledTimes(1);

      // 应产生 2 个 tool_call 和 2 个 tool_result 事件
      const toolCallEvents = events.filter((e) => e.type === "tool_call");
      const toolResultEvents = events.filter((e) => e.type === "tool_result");
      expect(toolCallEvents).toHaveLength(2);
      expect(toolResultEvents).toHaveLength(2);
    });
  });

  // ── stop() 中止测试 ──

  describe("中止循环", () => {
    it("调用 stop() 后应终止循环", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      // 直接停止
      loop.stop();
      expect(loop.state).toBe("idle");
    });
  });

  // ── 事件监听器测试 ──

  describe("事件监听器", () => {
    it("on() 应注册监听器并通过 state_change 事件通知", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      const receivedEvents: AgentEvent[] = [];
      const unsubscribe = loop.on((event) => receivedEvents.push(event));

      await collectEvents(loop.runStream("hi", "conv-6"));

      // 应收到 state_change 事件
      const stateChanges = receivedEvents.filter(
        (e) => e.type === "state_change",
      );
      expect(stateChanges.length).toBeGreaterThan(0);

      // 取消订阅后不应再收到事件
      const countBefore = receivedEvents.length;
      unsubscribe();

      // 再次运行，不应有新事件
      await collectEvents(loop.runStream("hi again", "conv-7"));
      expect(receivedEvents.length).toBe(countBefore);
    });
  });

  // ── Trace 持久化测试 ──

  describe("Trace 记录", () => {
    it("应在完成时持久化 trace", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      await collectEvents(loop.runStream("hello", "conv-8"));

      expect(memoryStore.addTrace).toHaveBeenCalledTimes(1);
      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(trace.conversationId).toBe("conv-8");
      expect(trace.tokensIn).toBe(50);
      expect(trace.tokensOut).toBe(20);
      expect(trace.model).toBe("mock-model");
      expect(trace.steps.length).toBeGreaterThan(0);
    });
  });

  // ── 连续错误停止测试 ──

  describe("连续错误自动停止", () => {
    it("连续 3 轮全部工具报错后应提前停止", async () => {
      // 每轮都调用一个工具，工具每次返回错误
      const toolCallChunks: LLMStreamChunk[] = [
        {
          type: "tool_use_start",
          toolUse: { id: "tc-1", name: "buggy_tool", input: "" },
        },
        {
          type: "tool_use_delta",
          toolUse: { id: "tc-1", name: "", input: "{}" },
        },
        {
          type: "done",
          usage: { tokensIn: 5, tokensOut: 3 },
          model: "mock-model",
        },
      ];

      // 提供 10 轮相同的 chunks（但应在第 3 轮后停止）
      const allChunks = Array(10).fill(toolCallChunks);
      const testProvider = createMockProvider(allChunks);

      const buggyTool = createMockTool("buggy_tool", {
        content: "error!",
        isError: true,
      });
      const testToolRegistry = createMockToolRegistry([buggyTool]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 10 },
      });

      const events = await collectEvents(loop.runStream("go", "conv-9"));

      // 由于 MAX_CONSECUTIVE_ERRORS=3，工具应只被调用 3 次
      // 但是 MAX_TOOL_FAILURES=2 也起作用——第 3 次调用时 buggy_tool 已经失败 2 次，
      // 会返回 "This tool has failed..." 而不是真正执行
      expect(buggyTool.execute).toHaveBeenCalledTimes(2);

      // 应有 response_complete
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
    });
  });
});

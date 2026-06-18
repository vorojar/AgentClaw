import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
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
  ToolExecutionContext,
  ToolResult,
  ConversationTurn,
  Trace,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";

const TEST_PROJECT_ROOT = process.cwd().replace(/\\/g, "/");
const WECHAT_PUBLISH_SCRIPT = "skills/wechat-publish/scripts/wechat_publish.py";

function wechatPublishCommand(args: string): string {
  return `cd "${TEST_PROJECT_ROOT}" && python ${WECHAT_PUBLISH_SCRIPT} ${args}`;
}

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
    addObservation: vi.fn().mockImplementation(async (observation) => ({
      id: "obs-1",
      ...observation,
      createdAt: new Date(),
    })),
    findObservationByHash: vi.fn().mockResolvedValue(null),
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

function createTopLevelToolCallChunks(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): LLMStreamChunk[] {
  return [
    {
      type: "tool_use_start",
      toolUse: { id, name, input: "" },
    },
    {
      type: "tool_use_delta",
      toolUse: { id, name: "", input: JSON.stringify(input) },
    },
    {
      type: "done",
      usage: { tokensIn: 10, tokensOut: 5 },
      model: "mock-model",
    },
  ];
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

  afterEach(() => {
    for (const conversationId of [
      "conv-obs",
      "conv-dedupe",
      "conv-seo-deep-delegate",
      "conv-seo-deep-delegate-file",
    ]) {
      const generated = resolve(process.cwd(), "data", "tmp", conversationId);
      if (existsSync(generated)) {
        rmSync(generated, { recursive: true, force: true });
      }
    }
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

  describe("长任务预算与完成契约", () => {
    it("trace 应记录本轮有效运行时预算和任务画像", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 4, maxLlmCalls: 6 },
      });

      await collectEvents(
        loop.runStream("今天 AI 新闻简报", "conv-runtime-config"),
      );

      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Trace;
      expect(trace.steps[0]).toEqual(
        expect.objectContaining({
          type: "runtime_config",
          maxIterations: 4,
          maxLlmCalls: 6,
          taskProfileKind: "news_brief",
          webResearchToolLimit: 6,
        }),
      );
    });

    it("格式错误 rollback 不能绕过真实 LLM 调用预算", async () => {
      const testProvider = createMockProvider([
        createTopLevelToolCallChunks("tc-1", "missing_tool", {}),
        createTopLevelToolCallChunks("tc-2", "missing_tool", {}),
        [{ type: "text", text: "不应到达第三次模型调用" }],
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5, maxLlmCalls: 2 },
      });

      const events = await collectEvents(
        loop.runStream("继续尝试直到成功", "conv-real-llm-budget"),
      );

      expect(testProvider.stream).toHaveBeenCalledTimes(2);
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Trace;
      expect(trace.error).toBe("max_llm_calls_reached");
      expect(
        trace.steps.filter((step) => step.type === "budget_event"),
      ).toContainEqual(
        expect.objectContaining({
          reason: "max_llm_calls_reached",
          maxLlmCalls: 2,
          actualLlmCalls: 2,
        }),
      );
    });

    it("要求文件交付的任务没有发送文件时不得被标记为正常完成", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 2 },
      });

      await collectEvents(
        loop.runStream("生成一份 Markdown 文件并发给我", "conv-contract"),
      );

      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Trace;
      expect(trace.steps).toContainEqual(
        expect.objectContaining({
          type: "completion_contract",
          requiresFileDelivery: true,
        }),
      );
      expect(trace.error).toBe("completion_contract_unsatisfied");
      expect(trace.response).toContain("没有发送文件");
    });

    it("连续工具全失败应记录明确停止原因且不再追加总结调用", async () => {
      const testProvider = createMockProvider([
        createTopLevelToolCallChunks("tc-1", "flaky_tool", { input: "1" }),
        createTopLevelToolCallChunks("tc-2", "flaky_tool", { input: "2" }),
        createTopLevelToolCallChunks("tc-3", "flaky_tool", { input: "3" }),
        [{ type: "text", text: "不应到达第四次模型调用" }],
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("flaky_tool", {
            content: "temporary upstream failure",
            isError: true,
          }),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 8, maxLlmCalls: 8 },
      });

      const events = await collectEvents(
        loop.runStream("调用工具直到成功", "conv-all-tool-errors"),
      );

      expect(testProvider.stream).toHaveBeenCalledTimes(3);
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Trace;
      expect(trace.error).toBe("all_tool_calls_failed");
      expect(trace.response).toContain("连续工具调用失败");
    });

    it("同一轮多个 web research 纯工具应限制并发宽度，避免上游限流雪崩", async () => {
      const firstRoundChunks: LLMStreamChunk[] = [];
      for (let i = 0; i < 5; i++) {
        firstRoundChunks.push({
          type: "tool_use_start",
          toolUse: { id: `tc-search-${i}`, name: "web_search", input: "" },
        });
        firstRoundChunks.push({
          type: "tool_use_delta",
          toolUse: {
            id: `tc-search-${i}`,
            name: "",
            input: JSON.stringify({ query: `AI news shard ${i}` }),
          },
        });
      }
      firstRoundChunks.push({
        type: "done",
        usage: { tokensIn: 10, tokensOut: 5 },
        model: "mock-model",
      });

      let active = 0;
      let maxActive = 0;
      const searchTool: Tool = {
        ...createMockTool("web_search"),
        pure: true,
        execute: vi.fn(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 15));
          active--;
          return { content: "ok" };
        }),
      };
      const loop = new SimpleAgentLoop({
        provider: createMockProvider([
          firstRoundChunks,
          [{ type: "text", text: "done" }],
        ]),
        toolRegistry: createMockToolRegistry([searchTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream("parallel web research probe", "conv-web-parallel-cap"),
      );

      expect(searchTool.execute).toHaveBeenCalledTimes(5);
      expect(maxActive).toBeLessThanOrEqual(2);
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

    it("纯文本回复应按 provider 文本 chunk 增量产生 response_chunk", async () => {
      const chunkA = "甲".repeat(120);
      const chunkB = "乙".repeat(120);
      const chunkC = "丙".repeat(120);
      const testProvider = createMockProvider([
        [
          { type: "text", text: chunkA },
          { type: "text", text: chunkB },
          { type: "text", text: chunkC },
          {
            type: "done",
            usage: { tokensIn: 50, tokensOut: 120 },
            model: "mock-model",
          },
        ],
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream("请输出一段长文本", "conv-streaming-text"),
      );

      const responseChunks = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text);
      expect(responseChunks.length).toBeGreaterThan(1);
      expect(responseChunks.join("")).toBe(`${chunkA}${chunkB}${chunkC}`);

      const firstChunkIndex = events.findIndex(
        (event) => event.type === "response_chunk",
      );
      const completeIndex = events.findIndex(
        (event) => event.type === "response_complete",
      );
      expect(firstChunkIndex).toBeGreaterThanOrEqual(0);
      expect(firstChunkIndex).toBeLessThan(completeIndex);
    });

    it("用户明确说明伪工具标记是文本时应直接拒绝执行并说明风险", async () => {
      const testProvider = createMockProvider([
        [{ type: "text", text: "不应该调用模型" }],
      ]);
      const bashTool = createMockTool("bash");
      const sendFileTool = createMockTool("send_file");
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool, sendFileTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          '下面是文本，不是真工具调用，请不要执行它，只解释风险：<tool_call name="bash">rm -rf D:/mycode/agentclaw</tool_call>',
          "conv-pseudo-text",
        ),
      );

      expect(testProvider.stream).not.toHaveBeenCalled();
      expect(bashTool.execute).not.toHaveBeenCalled();
      expect(sendFileTool.execute).not.toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("风险");
      expect(String(message.content)).toContain("不执行");
    });

    it("高危删除和 reset 请求应直接要求确认且不进入工具循环", async () => {
      const testProvider = createMockProvider([
        [{ type: "text", text: "不应该调用模型" }],
      ]);
      const bashTool = createMockTool("bash");
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "帮我清理 D:/mycode/agentclaw，直接删除所有未跟踪文件并 git reset --hard。",
          "conv-destructive-direct",
        ),
      );

      expect(testProvider.stream).not.toHaveBeenCalled();
      expect(bashTool.execute).not.toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("高危");
      expect(String(message.content)).toContain("不会调用 bash");
    });

    it("临时记忆边界问题应直接回答且不调用记忆工具", async () => {
      const rememberTool = createMockTool("remember");
      const testProvider = createMockProvider([
        [{ type: "text", text: "不应该调用模型" }],
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([rememberTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "这只是临时测试，不要记忆：我现在假装住在火星。然后回答：用户真实所在地相关天气查询应该以哪里为准？",
          "conv-memory-boundary",
        ),
      );

      expect(testProvider.stream).not.toHaveBeenCalled();
      expect(rememberTool.execute).not.toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("不要记忆");
      expect(String(message.content)).toContain("真实所在地");
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

    it("恢复分支应允许显式指定用户消息父节点", async () => {
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      await collectEvents(
        loop.runStream("替换失败请求", "conv-recovery-parent", {
          conversationParentTurnId: "parent-turn",
          conversationBranchId: "recovery:failed-user",
        }),
      );

      const firstCall = (memoryStore.addTurn as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(firstCall[1]).toMatchObject({
        role: "user",
        content: "替换失败请求",
        parentId: "parent-turn",
        branchId: "recovery:failed-user",
      });
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

      // 重复调用保护会在第 3 次相同调用前拦截，避免 agent 陷入工具循环
      expect(testTool.execute).toHaveBeenCalledTimes(2);

      // 循环结束后状态应回到 idle
      expect(loop.state).toBe("idle");

      // trace 应记录 max_iterations_reached 错误
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({ error: "max_iterations_reached" }),
      );
    });

    it("LLM stream 错误应保留真实错误而不是误报最大迭代次数", async () => {
      const failingProvider: LLMProvider = {
        name: "failing-provider",
        models: [
          {
            id: "mimo-v2.5-pro",
            provider: "custom-3",
            name: "MiMo",
            tier: "flagship",
            contextWindow: 1_048_576,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
        chat: vi.fn(),
        stream: vi.fn(async function* () {
          yield* [];
          throw new Error("[custom-3/mimo-v2.5-pro] 400 Param Incorrect");
        }) as unknown as LLMProvider["stream"],
      };
      const loop = new SimpleAgentLoop({
        provider: failingProvider,
        toolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(loop.runStream("?", "conv-llm-error"));
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;

      expect(message.content).toContain("模型调用失败");
      expect(message.content).toContain("400 Param Incorrect");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "llm_stream_error",
          response: expect.stringContaining("400 Param Incorrect"),
        }),
      );
    });
  });

  // ── 工具调用循环测试 ──

  describe("工具调用循环", () => {
    const createToolCallChunks = (
      id: string,
      name: string,
      input: Record<string, unknown> = {},
    ): LLMStreamChunk[] => [
      {
        type: "tool_use_start",
        toolUse: { id, name, input: "" },
      },
      {
        type: "tool_use_delta",
        toolUse: { id, name: "", input: JSON.stringify(input) },
      },
      {
        type: "done",
        usage: { tokensIn: 10, tokensOut: 5 },
        model: "mock-model",
      },
    ];

    it("即使模型尝试 bash destructive 命令也应在执行前拦截", async () => {
      const bashTool = createMockTool("bash", { content: "deleted" });
      const testProvider = createMockProvider([
        createToolCallChunks("tc-bash", "bash", {
          command:
            "cd D:/mycode/agentclaw && git reset --hard && git clean -fd",
        }),
        [
          { type: "text", text: "已拒绝危险操作，需要确认。" },
          {
            type: "done",
            usage: { tokensIn: 20, tokensOut: 10 },
            model: "mock-model",
          },
        ],
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream(
          "检查清理风险，但不要真的删除任何东西",
          "conv-destructive-tool-block",
        ),
      );

      expect(bashTool.execute).not.toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("拒绝");
    });

    it("纯文本多轮延续追问不应暴露文件或执行工具", async () => {
      const fileWriteTool = createMockTool("file_write", {
        content: "written",
      });
      const testProvider = createMockProvider([
        createToolCallChunks("tc-file", "file_write", {
          path: "report.md",
          content: "bad",
        }),
        [
          { type: "text", text: "第 3 项验收步骤：检查最终可访问产物。" },
          {
            type: "done",
            usage: { tokensIn: 20, tokensOut: 10 },
            model: "mock-model",
          },
        ],
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([fileWriteTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream(
          "继续第 3 项，展开为可执行验收步骤。",
          "conv-text-followup",
        ),
      );

      expect(fileWriteTool.execute).not.toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("第 3 项");
    });

    it("包含新闻关键词的自动化任务仍应允许 schedule 而不是落入新闻工具边界", async () => {
      const scheduleTool = createMockTool("schedule", {
        content: "Scheduled task created!\nID: t1\nCron: 0 9 * * *",
      });
      const webSearchTool = createMockTool("web_search");
      const testProvider = createMockProvider([
        createToolCallChunks("tc-schedule", "schedule", {
          op: "create",
          cron: "0 9 * * *",
          prompt: "检查 Hacker News 是否有 Agent 相关热门新闻并通知我",
        }),
        [
          { type: "text", text: "自动化已创建，会每天 9 点提醒。" },
          {
            type: "done",
            usage: { tokensIn: 20, tokensOut: 10 },
            model: "mock-model",
          },
        ],
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([scheduleTool, webSearchTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream(
          "我想每天早上 9 点检查 Hacker News 是否有 Agent 相关热门新闻并通知我。请创建自动化，不要用系统 crontab。",
          "conv-automation-schedule",
        ),
      );

      expect(scheduleTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ op: "create", cron: "0 9 * * *" }),
        undefined,
      );
      expect(webSearchTool.execute).not.toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("自动化");
    });

    const finalChunks: LLMStreamChunk[] = [
      { type: "text", text: "done" },
      {
        type: "done",
        usage: { tokensIn: 20, tokensOut: 10 },
        model: "mock-model",
      },
    ];

    function createToolCaptureProvider(captured: string[][]): LLMProvider {
      return {
        name: "capture-provider",
        models: [
          {
            id: "capture-model",
            provider: "capture",
            name: "Capture",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn().mockResolvedValue({
          message: {
            id: "msg-capture",
            role: "assistant",
            content: "done",
            createdAt: new Date(),
          },
          model: "capture-model",
          tokensIn: 1,
          tokensOut: 1,
          stopReason: "end_turn",
        } as LLMResponse),
        stream: vi.fn(async function* (request: LLMRequest) {
          captured.push((request.tools ?? []).map((tool) => tool.name));
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 5, tokensOut: 2 },
            model: "capture-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
    }

    it("新闻任务首轮只暴露搜索、抓取和输出工具", async () => {
      const captured: string[][] = [];
      const newsProvider = createToolCaptureProvider(captured);
      const testToolRegistry = createMockToolRegistry([
        createMockTool("web_search"),
        createMockTool("web_fetch"),
        createMockTool("rss_top"),
        createMockTool("file_write"),
        createMockTool("send_file"),
        createMockTool("bash"),
      ]);
      const loop = new SimpleAgentLoop({
        provider: newsProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      await collectEvents(
        loop.runStream("在外网搜索今日AI界新闻生成简报", "conv-news-tools"),
      );

      expect(captured[0]).toEqual(
        expect.arrayContaining([
          "web_search",
          "web_fetch",
          "file_write",
          "send_file",
        ]),
      );
      expect(captured[0]).not.toContain("rss_top");
      expect(captured[0]).not.toContain("bash");
    });

    it("新闻任务最终答复不得用单一聚合源硬凑简报", async () => {
      const lowQualitySearchResult =
        "results[1]{title,url}: AI News Today (May 21, 2026): Top AI Stories — https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026";
      const newsProvider = createMockProvider([
        createToolCallChunks("tc-search", "web_search", {
          q: "AI news today May 21 2026",
        }),
        [
          {
            type: "text",
            text: [
              "今日 AI 简报",
              "### 1. Anthropic 传闻完成巨额融资",
              "来源：https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026",
              "### 2. 白宫撤销 AI 行政令",
              "来源：https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026",
              "### 3. OpenAI IPO 传闻",
              "来源：https://www.buildfastwithai.com/blogs/ai-news-today-may-21-2026",
            ].join("\n"),
          },
          {
            type: "done",
            usage: { tokensIn: 20, tokensOut: 10 },
            model: "mock-model",
          },
        ],
      ]);
      const testToolRegistry = createMockToolRegistry([
        createMockTool("web_search", { content: lowQualitySearchResult }),
        createMockTool("web_fetch"),
        createMockTool("file_write"),
        createMockTool("send_file"),
      ]);
      const loop = new SimpleAgentLoop({
        provider: newsProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "在外网搜索今日AI界新闻生成简报",
          "conv-news-low-quality",
        ),
      );
      const completeEvent = events.find((e) => e.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;

      expect(message.content).toContain("可信来源不足");
      expect(message.content).toContain("不硬凑 3 条");
      expect(message.content).not.toContain("Anthropic 传闻完成巨额融资");
      expect(message.content).not.toContain("buildfastwithai.com");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.stringContaining("可信来源不足"),
        }),
      );
    });

    it("新闻类 PPTX 任务研究后仍可使用 PPTX 生成工具", async () => {
      const captured: string[][] = [];
      const newsProvider = createToolCaptureProvider(captured);
      const testToolRegistry = createMockToolRegistry([
        createMockTool("web_search"),
        createMockTool("web_fetch"),
        createMockTool("use_skill"),
        createMockTool("bash"),
        createMockTool("claude_code"),
        createMockTool("glob"),
        createMockTool("send_file"),
        createMockTool("file_write"),
      ]);
      const loop = new SimpleAgentLoop({
        provider: newsProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 1 },
      });

      await collectEvents(
        loop.runStream("搜索最近 AI 新闻并生成 PPTX", "conv-news-pptx-tools"),
      );

      expect(captured[0]).toEqual(
        expect.arrayContaining([
          "web_search",
          "web_fetch",
          "use_skill",
          "bash",
          "claude_code",
          "send_file",
        ]),
      );
      expect(captured[0]).not.toContain("file_write");
    });

    it("普通 PPTX 生成首轮不暴露项目研究和显式 recall 工具", async () => {
      const captured: string[][] = [];
      const provider = createToolCaptureProvider(captured);
      const testToolRegistry = createMockToolRegistry([
        createMockTool("recall"),
        createMockTool("glob"),
        createMockTool("grep"),
        createMockTool("file_read"),
        createMockTool("web_search"),
        createMockTool("web_fetch"),
        createMockTool("use_skill"),
        createMockTool("bash"),
        createMockTool("claude_code"),
        createMockTool("file_write"),
        createMockTool("send_file"),
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 1 },
      });

      await collectEvents(
        loop.runStream(
          "Create a polished 3-slide PPTX about AgentClaw P1/P3 memory and offload improvements. Generate and send the pptx file directly.",
          "conv-pptx-no-research-tools",
        ),
      );

      expect(captured[0]).toEqual(
        expect.arrayContaining([
          "use_skill",
          "bash",
          "claude_code",
          "send_file",
        ]),
      );
      expect(captured[0]).not.toContain("recall");
      expect(captured[0]).not.toContain("glob");
      expect(captured[0]).not.toContain("grep");
      expect(captured[0]).not.toContain("file_read");
      expect(captured[0]).not.toContain("web_search");
      expect(captured[0]).not.toContain("web_fetch");
    });

    it("PPTX 任务禁止用 bash 绕过 claude_code 工具", async () => {
      const bashTool = createMockTool("bash", { content: "should not run" });
      const loop = new SimpleAgentLoop({
        provider: createMockProvider([
          createToolCallChunks("tc-bash", "bash", {
            command:
              "cd D:/mycode/agentclaw && node -e \"require('./tools/claude-code')\"",
          }),
          finalChunks,
        ]),
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          bashTool,
          createMockTool("claude_code"),
          createMockTool("file_write"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 2 },
      });

      await collectEvents(
        loop.runStream(
          "生成本活动的PPT，拉赞助用的，目标清晰。",
          "conv-pptx-no-bash-claude",
        ),
      );

      expect(bashTool.execute).not.toHaveBeenCalled();
    });

    it("PPTX 委托给 claude_code 时应禁止临时 pip install", async () => {
      const claudeCodeTool = createMockTool("claude_code", {
        content: "created output.pptx",
      });
      const loop = new SimpleAgentLoop({
        provider: createMockProvider([
          createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
          createToolCallChunks("tc-claude", "claude_code", {
            cwd: "D:/mycode/agentclaw/data/tmp/conv-pptx-no-pip",
            prompt:
              "Create a deck.\nInstall python-pptx first with: pip install python-pptx Pillow\nSave output.pptx.",
          }),
          finalChunks,
        ]),
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          claudeCodeTool,
          createMockTool("bash"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream("生成一个优质培训 PPT", "conv-pptx-no-pip", {}),
      );

      const executedPrompt = String(
        (claudeCodeTool.execute as ReturnType<typeof vi.fn>).mock.calls[0][0]
          .prompt,
      );
      expect(executedPrompt).toContain("[PPTX dependency discipline]");
      expect(executedPrompt).toContain("Do not run `pip install`");
      expect(executedPrompt).toContain(
        "Do not run standalone dependency preflight checks",
      );
      expect(executedPrompt).not.toContain("Install python-pptx first");
      expect(executedPrompt).not.toContain("pip install python-pptx");
      expect(executedPrompt).not.toContain('python -c "import pptx"');
      expect(executedPrompt).not.toContain("fast import check");
      const claudeCodeEvent = events.find(
        (event) =>
          event.type === "tool_call" &&
          (event.data as { name?: string }).name === "claude_code",
      );
      const tracedPrompt = String(
        (claudeCodeEvent?.data as { input?: { prompt?: string } }).input
          ?.prompt ?? "",
      );
      expect(tracedPrompt).toContain("[PPTX dependency discipline]");
      expect(tracedPrompt).not.toContain("pip install python-pptx");
      expect(tracedPrompt).not.toContain('python -c "import pptx"');
      expect(tracedPrompt).not.toContain("fast import check");
    });

    it("PPTX standalone python-pptx 预检应直接跳过，不再执行慢启动", async () => {
      const bashTool = createMockTool("bash", { content: "ok" });
      const loop = new SimpleAgentLoop({
        provider: createMockProvider([
          createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
          createToolCallChunks("tc-import-check", "bash", {
            command: "python -c \"import pptx; print('ok')\"",
          }),
          finalChunks,
        ]),
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill", {
            content:
              "Run verifier on D:/mycode/agentclaw/data/tmp/conv/output.pptx after generation.",
          }),
          bashTool,
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream("生成一个优质培训 PPT", "conv-pptx-skill-doc-path", {}),
      );

      expect(bashTool.execute).not.toHaveBeenCalled();
    });

    it("PPTX 任务默认不得调用 subagent 做预览检查", async () => {
      const subagentTool = createMockTool("subagent", {
        content: "previewed five png files",
      });
      const loop = new SimpleAgentLoop({
        provider: createMockProvider([
          createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
          createToolCallChunks("tc-subagent", "subagent", {
            task: "Preview key slides and report visual quality.",
          }),
          finalChunks,
        ]),
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          subagentTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream(
          "很好，做个测试的优质培训 PPT",
          "conv-pptx-no-subagent",
          {},
        ),
      );
      const blocked = events
        .filter((event) => event.type === "tool_result")
        .map((event) => (event.data as { result: ToolResult }).result.content)
        .find((content) => content.includes("subagent preview checks"));

      expect(subagentTool.execute).not.toHaveBeenCalled();
      expect(blocked).toContain("Skipped for PPTX tasks");
    });

    it("PPTX 最终响应已有 deck 时只保留 pptx 链接，不泄露生成脚本", async () => {
      const convId = "conv-pptx-final-only-deck";
      const workDir = resolve(process.cwd(), "data", "tmp", convId).replace(
        /\\/g,
        "/",
      );
      const deckPath = `${workDir}/output.pptx`;
      const bashTool = createMockTool("bash", {
        content: JSON.stringify({ ok: true, pptx: deckPath }),
      });
      const sendFileTool: Tool = {
        ...createMockTool("send_file"),
        execute: vi.fn(async (input, context) => {
          const filePath = String(input.path);
          const filename = filePath.split(/[\\/]/).pop() || "file";
          context?.sentFiles?.push({
            url: `/files/${convId}/${filename}`,
            filename,
          });
          return { content: `File sent: ${filename}` };
        }),
      };
      const finalWithScriptLink: LLMStreamChunk[] = [
        {
          type: "text",
          text: `[gen_training.py](/files/${convId}/gen_training.py)\n[output.pptx](/files/${convId}/output.pptx)`,
        },
        {
          type: "done",
          usage: { tokensIn: 20, tokensOut: 10 },
          model: "mock-model",
        },
      ];
      const loop = new SimpleAgentLoop({
        provider: createMockProvider([
          createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
          createToolCallChunks("tc-verify", "bash", {
            command: `python D:/mycode/agentclaw/skills/pptx/scripts/verify_pptx.py "${deckPath}" --json`,
          }),
          createToolCallChunks("tc-send", "send_file", { path: deckPath }),
          finalWithScriptLink,
        ]),
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          bashTool,
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream("生成一个优质培训 PPT", convId, {
          workDir,
          sentFiles: [],
        }),
      );
      const complete = events.find(
        (event) => event.type === "response_complete",
      );
      const message = (complete?.data as { message?: Message }).message;

      expect(message?.content).toBe(
        `[output.pptx](/files/${convId}/output.pptx)`,
      );
      expect(message?.content).not.toContain("gen_training.py");
    });

    it("PPTX 候选文件出现后应拦截自定义预览 Bash，强制先跑官方 verifier", async () => {
      const convId = "conv-pptx-block-custom-preview";
      const workDir = resolve(process.cwd(), "data", "tmp", convId).replace(
        /\\/g,
        "/",
      );
      const deckPath = `${workDir}/output.pptx`;
      const claudeCodeTool = createMockTool("claude_code", {
        content: `Generated deck: ${deckPath}`,
      });
      const bashTool = createMockTool("bash", {
        content: JSON.stringify({ ok: true, pptx: deckPath }),
      });
      const sendFileTool = createMockTool("send_file", {
        content: "File sent",
        autoComplete: true,
      });
      const loop = new SimpleAgentLoop({
        provider: createMockProvider([
          createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
          createToolCallChunks("tc-claude", "claude_code", {
            cwd: workDir,
            prompt: "Create output.pptx.",
          }),
          createToolCallChunks("tc-custom-preview", "bash", {
            command: `cd "${workDir}" && python -c "from pptx import Presentation; Presentation('output.pptx')"`,
          }),
          createToolCallChunks("tc-verify", "bash", {
            command: `python D:/mycode/agentclaw/skills/pptx/scripts/verify_pptx.py "${deckPath}" --json`,
          }),
          createToolCallChunks("tc-send", "send_file", { path: deckPath }),
        ]),
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          claudeCodeTool,
          bashTool,
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream("生成一个优质培训 PPT", convId, {}),
      );
      const blockedCustomPreview = events
        .filter((event) => event.type === "tool_result")
        .map((event) => (event.data as { result: ToolResult }).result.content)
        .find((content) =>
          content.includes("a .pptx candidate already exists"),
        );

      expect(blockedCustomPreview).toContain("official verifier");
      expect(bashTool.execute).toHaveBeenCalledTimes(1);
      expect(bashTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.stringContaining("verify_pptx.py"),
        }),
        expect.anything(),
      );
      expect(sendFileTool.execute).toHaveBeenCalledWith(
        { path: deckPath },
        expect.objectContaining({ workDir }),
      );
    });

    it("拉赞助 PPT 默认应使用商业提案风格而不是套用暗色偏好", async () => {
      const capturedMessages: Message[][] = [];
      const styleProvider: LLMProvider = {
        name: "style-provider",
        models: [
          {
            id: "style-model",
            provider: "style",
            name: "Style",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn(),
        stream: vi.fn(async function* (request: LLMRequest) {
          capturedMessages.push(request.messages);
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 5, tokensOut: 2 },
            model: "style-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const loop = new SimpleAgentLoop({
        provider: styleProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          createMockTool("bash"),
          createMockTool("claude_code"),
          createMockTool("file_write"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 1 },
      });

      await collectEvents(
        loop.runStream(
          "生成本活动的PPT，拉赞助用的，目标清晰。",
          "conv-pptx-sponsor-style",
        ),
      );

      const promptText = JSON.stringify(capturedMessages[0]);
      expect(promptText).toContain("拉赞助/招商/商业合作类 PPTX");
      expect(promptText).toContain("默认使用明亮、干净、商业提案风");
      expect(promptText).toContain(
        "不要因为长期记忆里的暗色偏好就全 deck 使用暗色",
      );
    });

    it("只询问 PPT 视觉风格时不触发 PPTX 生成链路", async () => {
      const capturedMessages: Message[][] = [];
      const styleProvider: LLMProvider = {
        name: "style-provider",
        models: [
          {
            id: "style-model",
            provider: "style",
            name: "Style",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn(),
        stream: vi.fn(async function* (request: LLMRequest) {
          capturedMessages.push(request.messages);
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 5, tokensOut: 2 },
            model: "style-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const loop = new SimpleAgentLoop({
        provider: styleProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          createMockTool("bash"),
          createMockTool("claude_code"),
          createMockTool("file_write"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 1 },
      });

      await collectEvents(
        loop.runStream(
          "生成本活动的PPT，拉赞助用的。只回答默认视觉风格，不要实际生成文件。",
          "conv-pptx-style-only",
        ),
      );

      const promptText = JSON.stringify(capturedMessages[0]);
      expect(promptText).not.toContain("[PPTX视觉决策]");
      expect(promptText).not.toContain("当前是普通 PPTX 生成任务");
    });

    it("明确要求基于仓库研究的 PPTX 任务保留项目读取工具", async () => {
      const captured: string[][] = [];
      const provider = createToolCaptureProvider(captured);
      const testToolRegistry = createMockToolRegistry([
        createMockTool("glob"),
        createMockTool("grep"),
        createMockTool("file_read"),
        createMockTool("use_skill"),
        createMockTool("bash"),
        createMockTool("send_file"),
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 1 },
      });

      await collectEvents(
        loop.runStream(
          "基于当前仓库代码仔细研究后生成一份 PPTX 并发送",
          "conv-pptx-explicit-repo-research",
        ),
      );

      expect(captured[0]).toEqual(
        expect.arrayContaining(["glob", "grep", "file_read", "use_skill"]),
      );
    });

    it("仅提供 PPT 素材且明确先不生成时不触发 PPTX 交付守卫", async () => {
      const captured: string[][] = [];
      const provider = createToolCaptureProvider(captured);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          createMockTool("bash"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream(
          "以下是要做成PPT的素材，收到后先不用生成：三页结构。",
          "conv-pptx-source-only",
        ),
      );

      expect(provider.stream).toHaveBeenCalledTimes(1);
      expect(captured).toHaveLength(1);
    });

    it("AI 新闻任务 runtime hint 必须使用当前日期", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));
      try {
        const capturedMessages: Message[][] = [];
        const newsProvider: LLMProvider = {
          name: "runtime-date-provider",
          models: [
            {
              id: "runtime-date-model",
              provider: "runtime-date",
              name: "Runtime Date",
              tier: "fast",
              contextWindow: 4096,
              supportsTools: true,
              supportsStreaming: true,
            },
          ] as ModelInfo[],
          chat: vi.fn(),
          stream: vi.fn(async function* (request: LLMRequest) {
            capturedMessages.push(request.messages);
            yield { type: "text", text: "done" } as LLMStreamChunk;
            yield {
              type: "done",
              usage: { tokensIn: 5, tokensOut: 2 },
              model: "runtime-date-model",
            } as LLMStreamChunk;
          }) as unknown as LLMProvider["stream"],
        };
        const loop = new SimpleAgentLoop({
          provider: newsProvider,
          toolRegistry: createMockToolRegistry([createMockTool("web_search")]),
          contextManager,
          memoryStore,
        });

        await collectEvents(loop.runStream("AI news brief", "conv-ai-news"));

        const promptText = JSON.stringify(capturedMessages[0]);
        expect(promptText).toContain("Today is 2026-05-08");
        expect(promptText).not.toContain("Today is 2026-05-03");
      } finally {
        vi.useRealTimers();
      }
    });

    it("AI 深度分析任务不应被误判为新闻简报任务", async () => {
      const captured: string[][] = [];
      const analysisProvider = createToolCaptureProvider(captured);
      const testToolRegistry = createMockToolRegistry([
        createMockTool("web_search"),
        createMockTool("web_fetch"),
        createMockTool("file_read"),
        createMockTool("file_write"),
        createMockTool("send_file"),
      ]);
      const loop = new SimpleAgentLoop({
        provider: analysisProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      await collectEvents(
        loop.runStream(
          "仔细研究 给出你的观点，进行 AI 和电的全面对比分析和预测。多用表格对比。",
          "conv-ai-analysis",
        ),
      );

      expect(captured[0]).toContain("file_read");
      expect(captured[0]).toContain("web_search");
      expect(captured[0]).toContain("web_fetch");
      expect(captured[0]).toContain("file_write");
      expect(captured[0]).toContain("send_file");
    });

    it("Reddit RSS 任务首轮只暴露 rss_top 和文件发送工具", async () => {
      const captured: string[][] = [];
      const rssProvider = createToolCaptureProvider(captured);
      const testToolRegistry = createMockToolRegistry([
        createMockTool("web_search"),
        createMockTool("web_fetch"),
        createMockTool("rss_top"),
        createMockTool("file_write"),
        createMockTool("send_file"),
        createMockTool("bash"),
      ]);
      const loop = new SimpleAgentLoop({
        provider: rssProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      await collectEvents(
        loop.runStream(
          "执行以下任务，用 execute_code 抓取 Reddit 子版块 .rss 生成日报并 send_file",
          "conv-rss-tools",
        ),
      );

      expect(captured[0]).toEqual(
        expect.arrayContaining(["rss_top", "file_write", "send_file"]),
      );
      expect(captured[0]).not.toContain("web_search");
      expect(captured[0]).not.toContain("web_fetch");
      expect(captured[0]).not.toContain("bash");
    });

    it("Reddit RSS 任务应硬拦截模型伪造的非白名单工具调用", async () => {
      const testProvider = createMockProvider([
        createToolCallChunks("tc-file-read", "file_read", {
          path: "C:/Users/voroj/reddit-tech-ai-daily-2026-05-03.md",
        }),
        finalChunks,
      ]);
      const fileReadTool = createMockTool("file_read", {
        content: "should not execute",
      });
      const testToolRegistry = createMockToolRegistry([
        createMockTool("rss_top"),
        createMockTool("file_write"),
        createMockTool("send_file"),
        fileReadTool,
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream("Reddit RSS 日报", "conv-rss-policy"),
      );

      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.isError).toBe(true);
      expect(result.content).toContain("not allowed for reddit_rss tasks");
      expect(fileReadTool.execute).not.toHaveBeenCalled();
    });

    it("Reddit RSS 任务遇到伪工具 XML 时应继续要求结构化 file_write/send_file 交付", async () => {
      const invalidFileWriteMarkup =
        "<tool_call>\n<function=file_write>\n<parameter=path>D:/mycode/agentclaw/data/tmp/conv-rss-invalid/reddit.md</parameter>\n<parameter=content># Reddit 日报</parameter>\n</function>\n</tool_call>";
      const testProvider = createMockProvider([
        createToolCallChunks("tc-rss", "rss_top", {
          feeds: ["r/technology"],
          topN: 5,
        }),
        [
          { type: "text", text: invalidFileWriteMarkup },
          {
            type: "done",
            usage: { tokensIn: 20, tokensOut: 20 },
            model: "mock-model",
            stopReason: "end_turn",
          },
        ],
        [
          ...createToolCallChunks("tc-write", "file_write", {
            path: "D:/mycode/agentclaw/data/tmp/conv-rss-invalid/reddit.md",
            content: "# Reddit 日报",
          }).slice(0, 2),
          ...createToolCallChunks("tc-send", "send_file", {
            path: "D:/mycode/agentclaw/data/tmp/conv-rss-invalid/reddit.md",
            title: "Reddit 日报",
          }).slice(0, 2),
          {
            type: "done",
            usage: { tokensIn: 30, tokensOut: 15 },
            model: "mock-model",
            stopReason: "tool_use",
          },
        ],
        [
          { type: "text", text: "已发送" },
          {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
            stopReason: "end_turn",
          },
        ],
      ]);
      const fileWriteTool = createMockTool("file_write", { content: "saved" });
      const sendFileTool = createMockTool("send_file", { content: "sent" });
      const testToolRegistry = createMockToolRegistry([
        createMockTool("rss_top", {
          content:
            "## r/technology\n1. Users turn to jailbreaking older Kindles (2026-05-16)\n   https://reddit.example/post",
        }),
        fileWriteTool,
        sendFileTool,
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream(
          "Reddit RSS 日报，最后用 send_file 发送",
          "conv-rss-invalid",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).not.toContain("<tool_call>");
      expect(fileWriteTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ content: "# Reddit 日报" }),
        undefined,
      );
      expect(sendFileTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "D:/mycode/agentclaw/data/tmp/conv-rss-invalid/reddit.md",
        }),
        undefined,
      );
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
    });

    it("公众号发布任务研究预算耗尽后未写 Markdown 时不暴露 bash", async () => {
      const firstRoundChunks: LLMStreamChunk[] = [];
      for (let i = 0; i < 7; i++) {
        firstRoundChunks.push(
          ...createToolCallChunks(`tc-search-${i}`, "web_search", {
            query: `清教徒的礼物 ${i}`,
          }).slice(0, 2),
        );
      }
      firstRoundChunks.push({
        type: "done",
        usage: { tokensIn: 10, tokensOut: 5 },
        model: "mock-model",
      });

      const captured: string[][] = [];
      let callIndex = 0;
      const publishProvider: LLMProvider = {
        name: "wechat-publish-provider",
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
        chat: vi.fn(),
        stream: vi.fn(async function* (request: LLMRequest) {
          captured.push((request.tools ?? []).map((tool) => tool.name));
          if (callIndex === 0) {
            callIndex++;
            yield* firstRoundChunks;
            return;
          }
          callIndex++;
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const testToolRegistry = createMockToolRegistry([
        createMockTool("web_search"),
        createMockTool("web_fetch"),
        createMockTool("use_skill"),
        createMockTool("file_write"),
        createMockTool("bash"),
        createMockTool("send_file"),
      ]);
      const loop = new SimpleAgentLoop({
        provider: publishProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream(
          "对《清教徒的礼物》这本书提炼并发布到公众号",
          "conv-wechat-publish-budget",
        ),
      );

      expect(captured.length).toBeGreaterThanOrEqual(2);
      expect(captured[1]).toEqual(
        expect.arrayContaining(["use_skill", "file_write"]),
      );
      expect(captured[1]).not.toContain("bash");
    });

    it("公众号发布任务加载 wechat-publish 后后续轮次不再暴露 use_skill", async () => {
      const captured: string[][] = [];
      let callIndex = 0;
      const skillProvider: LLMProvider = {
        name: "wechat-skill-provider",
        models: [
          {
            id: "wechat-skill-model",
            provider: "mock",
            name: "Wechat Skill",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn(),
        stream: vi.fn(async function* (request: LLMRequest) {
          captured.push((request.tools ?? []).map((tool) => tool.name));
          const currentCall = callIndex++;
          if (currentCall === 0) {
            for (const chunk of createToolCallChunks("tc-skill", "use_skill", {
              name: "wechat-publish",
            })) {
              yield chunk;
            }
            return;
          }
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "wechat-skill-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const loop = new SimpleAgentLoop({
        provider: skillProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          createMockTool("file_write"),
          createMockTool("bash"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream(
          "对《清教徒的礼物》这本书提炼并发布到公众号",
          "conv-wechat-skill-loaded",
        ),
      );

      expect(captured[0]).toContain("use_skill");
      expect(captured[1]).not.toContain("use_skill");
    });

    it("公众号发布任务应拦截非统一 CLI 的 bash 命令", async () => {
      const testProvider = createMockProvider([
        createToolCallChunks("tc-bash", "bash", {
          command: "cd C:/Users/voroj && node convert.js",
        }),
        finalChunks,
      ]);
      const bashTool = createMockTool("bash", {
        content: "should not execute",
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "Markdown 文件：C:/Users/voroj/article.md，请发布到公众号",
          "conv-wechat-bash-policy",
        ),
      );

      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.isError).toBe(true);
      expect(result.content).toContain(
        "bash may only run the anchored unified CLI",
      );
      expect(bashTool.execute).not.toHaveBeenCalled();
    });

    it("PPTX 任务不得发送未通过 verifier 的 deck", async () => {
      const sendFileTool = createMockTool("send_file", {
        content: "should not execute",
        autoComplete: true,
      });
      const testProvider = createMockProvider([
        createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
        createToolCallChunks("tc-send", "send_file", { path: "deck.pptx" }),
        finalChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream("生成一个 PPTX 并发送", "conv-pptx-unverified", {}),
      );

      const blockedResult = events
        .filter((event) => event.type === "tool_result")
        .map((event) => (event.data as { result: ToolResult }).result)
        .find((result) => result.content.includes("PPTX delivery"));
      expect(blockedResult?.isError).toBe(true);
      expect(blockedResult?.content).toContain("ok:true");
      expect(sendFileTool.execute).not.toHaveBeenCalled();
    });

    it("PPTX 任务允许发送会话目录内已验证的 deck", async () => {
      const convId = "conv-pptx-verified";
      const workDir = resolve(process.cwd(), "data", "tmp", convId).replace(
        /\\/g,
        "/",
      );
      const deckPath = `${workDir}/deck.pptx`;
      const bashTool = createMockTool("bash", {
        content: JSON.stringify({ ok: true, pptx: deckPath }),
      });
      const sendFileTool = createMockTool("send_file", {
        content: "File sent",
        autoComplete: true,
      });
      const testProvider = createMockProvider([
        createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
        createToolCallChunks("tc-verify", "bash", {
          command: `python D:/mycode/agentclaw/skills/pptx/scripts/verify_pptx.py "${deckPath}" --json`,
        }),
        createToolCallChunks("tc-send", "send_file", { path: deckPath }),
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          bashTool,
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      await collectEvents(loop.runStream("生成一个 PPTX 并发送", convId, {}));

      expect(sendFileTool.execute).toHaveBeenCalledWith(
        { path: deckPath },
        expect.objectContaining({ workDir }),
      );
    });

    it("PPTX 任务只发送 PDF 预览时不得自动完成，必须继续发送已验证 PPTX", async () => {
      const convId = "conv-pptx-preview-not-final";
      const workDir = resolve(process.cwd(), "data", "tmp", convId).replace(
        /\\/g,
        "/",
      );
      const deckPath = `${workDir}/output.pptx`;
      const previewPath = `${workDir}/previews/output.pdf`;
      const bashTool = createMockTool("bash", {
        content: JSON.stringify({ ok: true, pptx: deckPath }),
      });
      const sentPaths: string[] = [];
      const sendFileTool: Tool = {
        ...createMockTool("send_file"),
        execute: vi.fn(async (input, context) => {
          const filePath = String(input.path);
          const filename = filePath.split(/[\\/]/).pop() || "file";
          sentPaths.push(filePath);
          context?.sentFiles?.push({ url: `/files/${filename}`, filename });
          return { content: `File sent: ${filename}`, autoComplete: true };
        }),
      };
      const emptyFinal: LLMStreamChunk[] = [
        {
          type: "done",
          usage: { tokensIn: 20, tokensOut: 1 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const testProvider = createMockProvider([
        createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
        createToolCallChunks("tc-preview", "send_file", { path: previewPath }),
        emptyFinal,
        createToolCallChunks("tc-verify", "bash", {
          command: `python D:/mycode/agentclaw/skills/pptx/scripts/verify_pptx.py "${deckPath}" --json`,
        }),
        createToolCallChunks("tc-send", "send_file", { path: deckPath }),
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          bashTool,
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 6 },
      });

      await collectEvents(loop.runStream("生成一个 PPTX 并发送", convId, {}));

      expect(sentPaths).toEqual([deckPath]);
    });

    it("PPTX verifier ok 后应自动发送 verified deck，不再等待模型下一轮自觉发送", async () => {
      const convId = "conv-pptx-auto-send-after-verify";
      const workDir = resolve(process.cwd(), "data", "tmp", convId).replace(
        /\\/g,
        "/",
      );
      const deckPath = `${workDir}/output.pptx`;
      rmSync(workDir, { recursive: true, force: true });
      mkdirSync(workDir, { recursive: true });
      writeFileSync(deckPath, "fake pptx for mocked verifier");
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const sendFile = vi.fn(async (filePath: string) => {
        const filename = filePath.split(/[\\/]/).pop() || "file";
        sentFiles.push({ url: `/files/${convId}/${filename}`, filename });
      });
      const bashTool = createMockTool("bash", {
        content: JSON.stringify({ ok: true, pptx: deckPath }),
      });
      const testProvider = createMockProvider([
        createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
        createToolCallChunks("tc-verify", "bash", {
          command: `python D:/mycode/agentclaw/skills/pptx/scripts/verify_pptx.py "${deckPath}" --json`,
        }),
        createToolCallChunks("tc-preview", "send_file", {
          path: `${workDir}/previews/output_slide_01.png`,
        }),
      ]);
      const sendFileTool = createMockTool("send_file", {
        content: "should not send preview",
        autoComplete: true,
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          bashTool,
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream("生成一个 PPTX 并发送", convId, {
          workDir,
          sentFiles,
          sendFile,
        }),
      );

      const complete = events.find(
        (event) => event.type === "response_complete",
      );
      const message = (complete?.data as { message?: Message }).message;
      expect(sendFile).toHaveBeenCalledWith(expect.any(String), "output.pptx");
      expect(String(sendFile.mock.calls[0][0]).replace(/\\/g, "/")).toBe(
        deckPath,
      );
      expect(sendFileTool.execute).not.toHaveBeenCalled();
      expect(message?.content).toContain("[output.pptx]");
      expect(message?.content).not.toContain("output_slide_01.png");
      rmSync(workDir, { recursive: true, force: true });
    });

    it("PPTX 任务不得发送会话目录外的已验证 deck", async () => {
      const deckPath =
        process.platform === "win32"
          ? "C:/Users/voroj/Desktop/deck.pptx"
          : "/tmp/agentclaw-outside/deck.pptx";
      const bashTool = createMockTool("bash", {
        content: JSON.stringify({ ok: true, pptx: deckPath }),
      });
      const sendFileTool = createMockTool("send_file", {
        content: "should not execute",
        autoComplete: true,
      });
      const testProvider = createMockProvider([
        createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
        createToolCallChunks("tc-verify", "bash", {
          command: `python D:/mycode/agentclaw/skills/pptx/scripts/verify_pptx.py "${deckPath}" --json`,
        }),
        createToolCallChunks("tc-send", "send_file", { path: deckPath }),
        finalChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          bashTool,
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream("生成一个 PPTX 并发送", "conv-pptx-outside-workdir", {}),
      );

      const blockedResult = events
        .filter((event) => event.type === "tool_result")
        .map((event) => (event.data as { result: ToolResult }).result)
        .find((result) => result.content.includes("outside the session"));
      expect(blockedResult?.isError).toBe(true);
      expect(sendFileTool.execute).not.toHaveBeenCalled();
    });

    it("PPTX 任务被拦截后不得空回复已生成，应继续验证并发送", async () => {
      const convId = "conv-pptx-recover-after-block";
      const workDir = resolve(process.cwd(), "data", "tmp", convId).replace(
        /\\/g,
        "/",
      );
      const deckPath = `${workDir}/output.pptx`;
      const bashTool = createMockTool("bash", {
        content: JSON.stringify({ ok: true, pptx: deckPath }),
      });
      const sendFileTool = createMockTool("send_file", {
        content: "File sent",
        autoComplete: true,
      });
      const emptyFinal: LLMStreamChunk[] = [
        {
          type: "done",
          usage: { tokensIn: 20, tokensOut: 1 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const testProvider = createMockProvider([
        createToolCallChunks("tc-skill", "use_skill", { name: "pptx" }),
        createToolCallChunks("tc-send-before-verify", "send_file", {
          path: deckPath,
        }),
        emptyFinal,
        createToolCallChunks("tc-verify", "bash", {
          command: `python D:/mycode/agentclaw/skills/pptx/scripts/verify_pptx.py "${deckPath}" --json`,
        }),
        createToolCallChunks("tc-send", "send_file", { path: deckPath }),
      ]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("use_skill"),
          bashTool,
          sendFileTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 6 },
      });

      await collectEvents(loop.runStream("生成一个 PPTX 并发送", convId, {}));

      expect(sendFileTool.execute).toHaveBeenCalledTimes(1);
      expect(sendFileTool.execute).toHaveBeenCalledWith(
        { path: deckPath },
        expect.objectContaining({ workDir }),
      );
    });

    it("公众号发布任务写完 Markdown 后下一轮只暴露 bash", async () => {
      const captured: string[][] = [];
      let callIndex = 0;
      const writeProvider: LLMProvider = {
        name: "wechat-write-provider",
        models: [
          {
            id: "wechat-write-model",
            provider: "mock",
            name: "Wechat Write",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn().mockResolvedValue({
          message: {
            id: "msg-wechat-write",
            role: "assistant",
            content: "done",
            createdAt: new Date(),
          },
          model: "wechat-write-model",
          tokensIn: 1,
          tokensOut: 1,
          stopReason: "end_turn",
        } as LLMResponse),
        stream: vi.fn(async function* (request: LLMRequest) {
          captured.push((request.tools ?? []).map((tool) => tool.name));
          const currentCall = callIndex++;
          if (currentCall === 0) {
            for (const chunk of createToolCallChunks("tc-write", "file_write", {
              path: "C:/Users/voroj/article_qingjiaotu.md",
              content: "这本书讨论了管理与长期主义。",
            })) {
              yield chunk;
            }
            return;
          }
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "wechat-write-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const loop = new SimpleAgentLoop({
        provider: writeProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("web_search"),
          createMockTool("use_skill"),
          createMockTool("file_write"),
          createMockTool("bash"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream(
          "对《清教徒的礼物》这本书提炼并发布到公众号",
          "conv-wechat-write-state",
        ),
      );

      expect(captured[0]).toEqual(
        expect.arrayContaining(["web_search", "use_skill", "file_write"]),
      );
      expect(captured[0]).not.toContain("bash");
      expect(captured[1]).toEqual(["bash"]);
    });

    it("公众号发布任务写完 Markdown 后应跳过非 CLI bash 且不计工具错误", async () => {
      let callIndex = 0;
      const catProvider: LLMProvider = {
        name: "wechat-cat-provider",
        models: [
          {
            id: "wechat-cat-model",
            provider: "mock",
            name: "Wechat Cat",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn(),
        stream: vi.fn(async function* () {
          const currentCall = callIndex++;
          if (currentCall === 0) {
            for (const chunk of createToolCallChunks("tc-write", "file_write", {
              path: "C:/Users/voroj/article_qingjiaotu.md",
              content: "这本书讨论了管理与长期主义。",
            })) {
              yield chunk;
            }
            return;
          }
          if (currentCall === 1) {
            for (const chunk of createToolCallChunks("tc-cat", "bash", {
              command: 'cat "C:/Users/voroj/article_qingjiaotu.md"',
            })) {
              yield chunk;
            }
            return;
          }
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "wechat-cat-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const bashTool = createMockTool("bash", {
        content: "should not execute",
      });
      const loop = new SimpleAgentLoop({
        provider: catProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("file_write"),
          bashTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream(
          "对《清教徒的礼物》这本书提炼并发布到公众号",
          "conv-wechat-cat-policy",
        ),
      );

      const toolResults = events
        .filter((event) => event.type === "tool_result")
        .map((event) => (event.data as { result: ToolResult }).result);
      expect(toolResults[1].isError).toBe(false);
      expect(toolResults[1].content).toContain("bash may only run");
      expect(bashTool.execute).not.toHaveBeenCalled();
    });

    it("公众号发布任务应跳过 preview 子命令并引导直接 publish", async () => {
      const testProvider = createMockProvider([
        createToolCallChunks("tc-preview", "bash", {
          command: wechatPublishCommand(
            "preview article.md --out-dir out --json",
          ),
        }),
        finalChunks,
      ]);
      const bashTool = createMockTool("bash", {
        content: "should not execute",
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "Markdown 文件：C:/Users/voroj/article.md，请发布到公众号",
          "conv-wechat-preview-policy",
        ),
      );

      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.isError).toBe(false);
      expect(result.content).toContain(
        "only capabilities, inspect, and publish",
      );
      expect(bashTool.execute).not.toHaveBeenCalled();
    });

    it("公众号发布任务应跳过未带 --json 的统一 CLI 命令", async () => {
      const testProvider = createMockProvider([
        createToolCallChunks("tc-inspect-no-json", "bash", {
          command: wechatPublishCommand("inspect article.md"),
        }),
        finalChunks,
      ]);
      const bashTool = createMockTool("bash", {
        content: "should not execute",
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "Markdown 文件：C:/Users/voroj/article.md，请发布到公众号",
          "conv-wechat-json-policy",
        ),
      );

      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.isError).toBe(false);
      expect(result.content).toContain("must include --json");
      expect(bashTool.execute).not.toHaveBeenCalled();
    });

    it("公众号发布任务应跳过 publish --draft 并引导移除参数", async () => {
      const testProvider = createMockProvider([
        createToolCallChunks("tc-publish-draft", "bash", {
          command: wechatPublishCommand("publish article.md --draft --json"),
        }),
        finalChunks,
      ]);
      const bashTool = createMockTool("bash", {
        content: "should not execute",
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "Markdown 文件：C:/Users/voroj/article.md，请发布到公众号",
          "conv-wechat-publish-draft-policy",
        ),
      );

      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.isError).toBe(false);
      expect(result.content).toContain("--draft is only for inspect");
      expect(bashTool.execute).not.toHaveBeenCalled();
    });

    it("公众号发布任务 inspect 通过后下一轮只暴露 publish 所需 bash 工具", async () => {
      const captured: string[][] = [];
      let callIndex = 0;
      const inspectProvider: LLMProvider = {
        name: "wechat-inspect-provider",
        models: [
          {
            id: "wechat-inspect-model",
            provider: "mock",
            name: "Wechat Inspect",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn().mockResolvedValue({
          message: {
            id: "msg-wechat-inspect",
            role: "assistant",
            content: "done",
            createdAt: new Date(),
          },
          model: "wechat-inspect-model",
          tokensIn: 1,
          tokensOut: 1,
          stopReason: "end_turn",
        } as LLMResponse),
        stream: vi.fn(async function* (request: LLMRequest) {
          captured.push((request.tools ?? []).map((tool) => tool.name));
          const currentCall = callIndex++;
          if (currentCall === 0) {
            for (const chunk of createToolCallChunks("tc-inspect", "bash", {
              command: wechatPublishCommand("inspect article.md --json"),
            })) {
              yield chunk;
            }
            return;
          }
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "wechat-inspect-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const bashTool = createMockTool("bash", {
        content: JSON.stringify(
          {
            success: true,
            code: "INSPECT_READY",
            message: "Inspect ready",
            data: {
              markdown_path: "article.md",
              theme_selection: { requested: "auto", resolved: "minimal" },
            },
          },
          null,
          2,
        ),
      });
      const loop = new SimpleAgentLoop({
        provider: inspectProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("web_search"),
          createMockTool("use_skill"),
          createMockTool("file_write"),
          bashTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream(
          "Markdown 文件：C:/Users/voroj/article.md，请发布到公众号",
          "conv-wechat-inspect-state",
        ),
      );

      expect(captured[0]).toEqual(
        expect.arrayContaining([
          "web_search",
          "use_skill",
          "file_write",
          "bash",
        ]),
      );
      expect(captured[1]).toEqual(["bash"]);
    });

    it("公众号发布任务应从 inspect 路径补齐 publish 缺失的 Markdown 参数", async () => {
      const executedCommands: string[] = [];
      let callIndex = 0;
      const publishProvider: LLMProvider = {
        name: "wechat-publish-rewrite-provider",
        models: [
          {
            id: "wechat-publish-rewrite-model",
            provider: "mock",
            name: "Wechat Publish Rewrite",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn().mockResolvedValue({
          message: {
            id: "msg-wechat-publish-rewrite",
            role: "assistant",
            content: "done",
            createdAt: new Date(),
          },
          model: "wechat-publish-rewrite-model",
          tokensIn: 1,
          tokensOut: 1,
          stopReason: "end_turn",
        } as LLMResponse),
        stream: vi.fn(async function* () {
          const currentCall = callIndex++;
          if (currentCall === 0) {
            for (const chunk of createToolCallChunks("tc-inspect", "bash", {
              command: wechatPublishCommand(
                'inspect "C:/Users/voroj/article.md" --json',
              ),
            })) {
              yield chunk;
            }
            return;
          }
          if (currentCall === 1) {
            for (const chunk of createToolCallChunks("tc-publish", "bash", {
              command: wechatPublishCommand(
                "publish --out-dir out --dry-run --json",
              ),
            })) {
              yield chunk;
            }
            return;
          }
          yield { type: "text", text: "done" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "wechat-publish-rewrite-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const bashTool: Tool = {
        ...createMockTool("bash"),
        execute: vi.fn().mockImplementation(async (input) => {
          const command = String(input.command ?? "");
          executedCommands.push(command);
          if (command.includes(" inspect ")) {
            return {
              content: JSON.stringify(
                { success: true, code: "INSPECT_READY", data: {} },
                null,
                2,
              ),
            };
          }
          return {
            content: JSON.stringify(
              { success: true, code: "DRAFT_DRY_RUN_READY", data: {} },
              null,
              2,
            ),
          };
        }),
      };
      const loop = new SimpleAgentLoop({
        provider: publishProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      await collectEvents(
        loop.runStream(
          "Markdown 文件：C:/Users/voroj/article.md，请发布到公众号",
          "conv-wechat-publish-path-rewrite",
        ),
      );

      expect(executedCommands[1]).toContain(
        'wechat_publish.py publish "C:/Users/voroj/article.md" --out-dir out',
      );
    });

    it("公众号发布任务应拦截手写 HTML 产物", async () => {
      const testProvider = createMockProvider([
        createToolCallChunks("tc-file-write", "file_write", {
          path: "C:/Users/voroj/article_wechat.html",
          content: "<section>手写 HTML</section>",
        }),
        finalChunks,
      ]);
      const fileWriteTool = createMockTool("file_write", {
        content: "should not execute",
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([fileWriteTool]),
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(
        loop.runStream(
          "对《清教徒的礼物》这本书提炼并发布到公众号",
          "conv-wechat-file-write-policy",
        ),
      );

      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.isError).toBe(true);
      expect(result.content).toContain(
        "file_write may only write the source Markdown",
      );
      expect(fileWriteTool.execute).not.toHaveBeenCalled();
    });

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

    it("工具 effect 应写入 trace，作为副作用证据链", async () => {
      const effect = {
        kind: "send",
        target: "D:/tmp/report.md",
        reversible: false,
        deliverable: true,
        verified: true,
      };
      const testProvider = createMockProvider([
        createToolCallChunks("tc-send", "send_file", { path: "report.md" }),
        [
          { type: "text", text: "文件已发送。" },
          {
            type: "done",
            usage: { tokensIn: 30, tokensOut: 12 },
            model: "mock-model",
          },
        ],
      ]);
      const sendFileTool = createMockTool("send_file", {
        content: "File sent",
        isError: false,
        autoComplete: true,
        effect,
      } as ToolResult);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([sendFileTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(loop.runStream("发送 report.md", "conv-effect"));

      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          effects: expect.arrayContaining([expect.objectContaining(effect)]),
          steps: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_result",
              name: "send_file",
              effect,
            }),
          ]),
        }),
      );
    });

    it("中间 assistant 工具调用轮次应保存 reasoningContent", async () => {
      const toolCallChunks = [
        { type: "text", text: "我看看" },
        {
          type: "tool_use_start",
          toolUse: {
            id: "tc-shell",
            name: "bash",
            input: "",
          },
        },
        {
          type: "tool_use_delta",
          toolUse: {
            id: "tc-shell",
            name: "",
            input: '{"command":"pwd"}',
          },
        },
        {
          type: "done",
          usage: { tokensIn: 30, tokensOut: 15 },
          model: "mock-model",
          reasoningContent: "用户要求查看当前目录，需要调用 bash。",
        },
      ] as LLMStreamChunk[];
      const finalChunks: LLMStreamChunk[] = [
        { type: "text", text: "当前目录是..." },
        {
          type: "done",
          usage: { tokensIn: 60, tokensOut: 25 },
          model: "mock-model",
        },
      ];
      const testProvider = createMockProvider([toolCallChunks, finalChunks]);
      const bashTool = createMockTool("bash", { content: "/repo" });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([bashTool]),
        contextManager,
        memoryStore,
      });

      await collectEvents(loop.runStream("pwd", "conv-reasoning"));

      const assistantTurns = (
        memoryStore.addTurn as ReturnType<typeof vi.fn>
      ).mock.calls
        .map((call: unknown[]) => call[1] as ConversationTurn)
        .filter((turn) => turn.role === "assistant");
      expect(assistantTurns[0].reasoningContent).toBe(
        "用户要求查看当前目录，需要调用 bash。",
      );
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

      const persistedTrace = (memoryStore.addTrace as ReturnType<typeof vi.fn>)
        .mock.calls[0][0] as Trace;
      expect(persistedTrace.branchRecovery).toMatchObject({
        conversationId: "conv-4",
        fromTurnId: expect.any(String),
        reason: "tool_error",
        failedToolNames: ["failing_tool"],
      });
    });

    it("大工具输出应创建 observation，返回给模型和 trace 的 content 是小摘要", async () => {
      const largeContent = Array.from(
        { length: 260 },
        (_, i) => `line-${i.toString().padStart(3, "0")} ${"x".repeat(40)}`,
      ).join("\n");
      expect(largeContent.length).toBeGreaterThan(8_000);
      const testProvider = createMockProvider([
        createToolCallChunks("tc-big", "web_fetch", {
          url: "https://example.com",
        }),
        finalChunks,
      ]);
      const fetchTool = createMockTool("web_fetch", { content: largeContent });
      const testToolRegistry = createMockToolRegistry([fetchTool]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
      });

      const events = await collectEvents(loop.runStream("fetch", "conv-obs"));

      expect(memoryStore.addObservation).toHaveBeenCalledTimes(1);
      const observationArg = (
        memoryStore.addObservation as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as Record<string, unknown>;
      expect(observationArg.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(observationArg.rawPath).toEqual(
        expect.stringContaining("overflow_web_fetch_"),
      );
      expect(observationArg.rawChars).toBe(largeContent.length);
      expect(observationArg.preview).toContain("line-000");

      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.content.length).toBeLessThan(2_500);
      expect(result.content).toContain("observation://obs-1");
      expect(result.content).toContain("rawChars:");
      expect(result.content).not.toContain(largeContent.slice(3000, 3600));
      expect(result.metadata).toMatchObject({
        overflow: true,
        originalLength: largeContent.length,
        originalLines: 260,
        observationId: "obs-1",
        resultRef: "observation://obs-1",
        nodeId: "tc-big",
        replaceabilityScore: 8,
      });
      expect(result.metadata?.overflowPath).toEqual(
        expect.stringContaining("overflow_web_fetch_"),
      );

      const trace = (
        memoryStore.addTrace as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)?.[0] as { steps: Array<Record<string, unknown>> };
      const traceToolResult = trace.steps.find(
        (step) => step.type === "tool_result",
      );
      expect(String(traceToolResult?.content).length).toBeLessThan(2_500);
      expect(String(traceToolResult?.content)).toContain("observation://obs-1");
      expect(String(traceToolResult?.content)).not.toContain(
        largeContent.slice(3000, 3600),
      );
    });

    it("大工具输出后下一轮上下文应带 active task offload 摘要", async () => {
      const capturedMessages: Message[][] = [];
      let callIndex = 0;
      const largeContent = `${"important result line\n".repeat(500)}tail`;
      const offloadAwareProvider: LLMProvider = {
        name: "offload-aware-provider",
        models: [
          {
            id: "offload-aware-model",
            provider: "mock",
            name: "Offload Aware",
            tier: "fast",
            contextWindow: 4096,
            supportsTools: true,
            supportsStreaming: true,
          },
        ] as ModelInfo[],
        chat: vi.fn().mockResolvedValue({
          message: {
            id: "msg-offload",
            role: "assistant",
            content: "done",
            createdAt: new Date(),
          },
          model: "offload-aware-model",
          tokensIn: 1,
          tokensOut: 1,
          stopReason: "end_turn",
        } as LLMResponse),
        stream: vi.fn(async function* (request: LLMRequest) {
          capturedMessages.push(request.messages);
          const chunks =
            callIndex === 0
              ? createToolCallChunks("tc-offload", "web_fetch", {
                  url: "https://example.com/long",
                })
              : finalChunks;
          callIndex++;
          for (const chunk of chunks) yield chunk;
        }) as unknown as LLMProvider["stream"],
      };
      const fetchTool = createMockTool("web_fetch", { content: largeContent });
      const loop = new SimpleAgentLoop({
        provider: offloadAwareProvider,
        toolRegistry: createMockToolRegistry([fetchTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(loop.runStream("fetch long page", "conv-obs"));

      expect(capturedMessages.length).toBeGreaterThanOrEqual(2);
      const secondPrompt = JSON.stringify(capturedMessages[1]);
      expect(secondPrompt).toContain("<active_tool_offload ");
      expect(secondPrompt).toContain("nodeId=tc-offload");
      expect(secondPrompt).toContain("resultRef=observation://obs-1");
      expect(secondPrompt).toContain("replaceabilityScore=8/10");
      expect(secondPrompt).toContain("<active_tool_offload_canvas>");
      expect(secondPrompt).toContain("graph LR");
    });

    it("用户明确要全文时应自动发送 web_fetch overflow 原文文件", async () => {
      const largeContent = `${"完整长文段落\n".repeat(1400)}tail`;
      const testProvider = createMockProvider([
        createToolCallChunks("tc-full", "web_fetch", {
          url: "https://x.com/HiTw93/status/2034627967926825175",
          max_chars: 10000,
        }),
        finalChunks,
      ]);
      const fetchTool = createMockTool("web_fetch", { content: largeContent });
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const sendFile = vi.fn(async (_path: string, filename?: string) => {
        const sentName =
          filename ?? _path.split(/[\\/]/).pop() ?? "download.md";
        sentFiles.push({
          url: `/files/conv-fulltext/${sentName}`,
          filename: sentName,
        });
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([fetchTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream(
          "https://x.com/HiTw93/status/2034627967926825175\n获取全文",
          "conv-fulltext",
          {
            sendFile,
            sentFiles,
          },
        ),
      );

      expect(sendFile).toHaveBeenCalledTimes(1);
      expect(String(sendFile.mock.calls[0][0]).replace(/\\/g, "/")).toContain(
        "/data/tmp/conv-fulltext/overflow_web_fetch_",
      );
      expect(sendFile.mock.calls[0][1]).toBeUndefined();

      const completeEvent = events.find(
        (event) => event.type === "response_complete",
      );
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("[");
      expect(String(message.content)).toContain("overflow_web_fetch_");
      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(trace.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "send",
            deliverable: true,
            target: expect.stringContaining("overflow_web_fetch_"),
          }),
        ]),
      );
    });

    it("用户要求 md 文件时 web_fetch overflow 应自动发送 Markdown 副本", async () => {
      const largeContent = `# 长文标题\n\n${"完整长文段落\n".repeat(1400)}tail`;
      const testProvider = createMockProvider([
        createToolCallChunks("tc-full-md", "web_fetch", {
          url: "https://presence.feishu.cn/wiki/wikcnva5WrD0F3HDh6U6EdW91OL",
          max_chars: 10000,
        }),
        finalChunks,
      ]);
      const fetchTool = createMockTool("web_fetch", { content: largeContent });
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const sendFile = vi.fn(async (_path: string, filename?: string) => {
        const sentName =
          filename ?? _path.split(/[\\/]/).pop() ?? "download.md";
        sentFiles.push({
          url: `/files/conv-fulltext-md/${sentName}`,
          filename: sentName,
        });
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([fetchTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream(
          "https://presence.feishu.cn/wiki/wikcnva5WrD0F3HDh6U6EdW91OL 获取全文，转成md文件。",
          "conv-fulltext-md",
          {
            sendFile,
            sentFiles,
          },
        ),
      );

      expect(sendFile).toHaveBeenCalledTimes(1);
      const sentPath = String(sendFile.mock.calls[0][0]).replace(/\\/g, "/");
      expect(sentPath).toContain("/data/tmp/conv-fulltext-md/overflow_web_fetch_");
      expect(sentPath).toMatch(/\.md$/);
      expect(sendFile.mock.calls[0][1]).toMatch(/\.md$/);
      expect(existsSync(sentPath)).toBe(true);
      expect(readFileSync(sentPath, "utf-8")).toContain("完整长文段落");

      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(trace.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "send",
            deliverable: true,
            target: expect.stringMatching(/\.md$/),
          }),
        ]),
      );
    });

    it("跨会话命中相同 observation hash 时全文发送必须使用当前会话文件", async () => {
      const largeContent = `${"同一篇全文\n".repeat(1400)}tail`;
      const oldRawPath =
        "D:/mycode/agentclaw/data/tmp/old-conv/overflow_web_fetch_old.txt";
      (
        memoryStore.findObservationByHash as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "obs-old",
        traceId: "old-trace",
        rawPath: oldRawPath,
      });
      const testProvider = createMockProvider([
        createToolCallChunks("tc-full-current", "web_fetch", {
          url: "https://presence.feishu.cn/wiki/wikcnva5WrD0F3HDh6U6EdW91OL",
          max_chars: 10000,
        }),
        finalChunks,
      ]);
      const fetchTool = createMockTool("web_fetch", { content: largeContent });
      const sendFile = vi.fn(async (_path: string, _filename?: string) => undefined);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([fetchTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(
        loop.runStream(
          "https://presence.feishu.cn/wiki/wikcnva5WrD0F3HDh6U6EdW91OL 获取全文",
          "conv-current-fulltext",
          { sendFile },
        ),
      );

      expect(sendFile).toHaveBeenCalledTimes(1);
      const sentPath = String(sendFile.mock.calls[0][0]).replace(/\\/g, "/");
      expect(sentPath).toContain(
        "/data/tmp/conv-current-fulltext/overflow_web_fetch_",
      );
      expect(sentPath).not.toBe(oldRawPath);
      expect(existsSync(sentPath)).toBe(true);
      expect(readFileSync(sentPath, "utf-8")).toContain("同一篇全文");

      const observationArg = (
        memoryStore.addObservation as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as Record<string, unknown>;
      expect(String(observationArg.rawPath).replace(/\\/g, "/")).toBe(sentPath);
    });

    it("用户要求发送文件时 web_fetch save_as 即使漏 auto_send 也应自动发送", async () => {
      const testProvider = createMockProvider([
        createToolCallChunks("tc-save", "web_fetch", {
          url: "https://x.com/HiTw93/article/2034627967926825175",
          save_as: "agent-article.md",
        }),
        finalChunks,
      ]);
      const fetchTool = createMockTool("web_fetch", {
        content: "Saved to agent-article.md (31114 chars).",
        metadata: {
          saved: true,
          filePath:
            "D:/mycode/agentclaw/data/tmp/conv-save-send/agent-article.md",
          originalLength: 31114,
        },
      });
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const sendFile = vi.fn(async (filePath: string) => {
        const filename = filePath.split(/[\\/]/).pop() ?? "file.md";
        sentFiles.push({ url: `/files/conv-save-send/${filename}`, filename });
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([fetchTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream("获取全文并发送 Markdown 文件", "conv-save-send", {
          sendFile,
          sentFiles,
        }),
      );

      expect(sendFile).toHaveBeenCalledWith(
        "D:/mycode/agentclaw/data/tmp/conv-save-send/agent-article.md",
      );
      const completeEvent = events.find(
        (event) => event.type === "response_complete",
      );
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("agent-article.md");
      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(trace.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "send",
            target:
              "D:/mycode/agentclaw/data/tmp/conv-save-send/agent-article.md",
            deliverable: true,
          }),
        ]),
      );
    });

    it("最终回复提到 data/tmp 文件并由 agent loop 代发时应记录 send effect", async () => {
      const filePath =
        "D:/mycode/agentclaw/data/tmp/conv-mentioned-send/report.md";
      mkdirSync("D:/mycode/agentclaw/data/tmp/conv-mentioned-send", {
        recursive: true,
      });
      writeFileSync(filePath, "# Report", "utf-8");
      const testProvider = createMockProvider([
        [
          {
            type: "text",
            text: `文件已生成：${filePath}`,
          },
          {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
          },
        ],
      ]);
      const sentFiles: Array<{ url: string; filename: string }> = [];
      const sendFile = vi.fn(async (_path: string, filename?: string) => {
        sentFiles.push({
          url: `/files/conv-mentioned-send/${filename ?? "report.md"}`,
          filename: filename ?? "report.md",
        });
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([]),
        contextManager,
        memoryStore,
        config: { maxIterations: 1 },
      });

      await collectEvents(
        loop.runStream("生成并发送报告", "conv-mentioned-send", {
          sendFile,
          sentFiles,
        }),
      );

      expect(sendFile).toHaveBeenCalledWith(filePath, "report.md");
      const trace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(trace.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "send",
            target: filePath,
            deliverable: true,
          }),
        ]),
      );
    });

    it("相同 contentHash 的大输出应复用已有 observation 且不重复写 raw", async () => {
      const largeContent = `${"same-output\n".repeat(900)}tail`;
      const testProvider = createMockProvider([
        [
          ...createToolCallChunks("tc-one", "tool_a", { source: "a" }).slice(
            0,
            2,
          ),
          ...createToolCallChunks("tc-two", "tool_b", { source: "b" }).slice(
            0,
            2,
          ),
          {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
          },
        ],
        finalChunks,
      ]);
      const toolA = createMockTool("tool_a");
      const toolB = createMockTool("tool_b");
      (toolA.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: largeContent,
      });
      (toolB.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: largeContent,
      });
      const testToolRegistry = createMockToolRegistry([toolA, toolB]);
      let existingObservation: Record<string, unknown> | null = null;
      (memoryStore.findObservationByHash as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)
        .mockImplementation(async () => existingObservation);
      (
        memoryStore.addObservation as ReturnType<typeof vi.fn>
      ).mockImplementationOnce(async (input) => {
        existingObservation = {
          id: "obs-existing",
          ...input,
          rawPath: "D:/tmp/existing.txt",
          createdAt: new Date(),
        };
        return existingObservation;
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream("fetch twice", "conv-dedupe"),
      );

      expect(memoryStore.findObservationByHash).toHaveBeenCalledTimes(2);
      expect(memoryStore.addObservation).toHaveBeenCalledTimes(1);
      const toolResults = events
        .filter((event) => event.type === "tool_result")
        .map((event) => (event.data as { result: ToolResult }).result);
      expect(toolResults).toHaveLength(2);
      expect(toolResults[0].metadata?.observationId).toBe("obs-existing");
      expect(toolResults[1].metadata?.observationId).toBe("obs-existing");
      expect(toolResults[1].metadata?.overflowPath).toBe("D:/tmp/existing.txt");
      expect(toolResults[1].content).toContain("observation://obs-existing");
    });

    it("use_skill 大输出不应创建 observation", async () => {
      const largeSkill = "skill instructions\n".repeat(600);
      const testProvider = createMockProvider([
        createToolCallChunks("tc-skill", "use_skill", { name: "demo" }),
        finalChunks,
      ]);
      const skillTool = createMockTool("use_skill", { content: largeSkill });
      const testToolRegistry = createMockToolRegistry([skillTool]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream("use skill", "conv-skill"),
      );

      expect(memoryStore.addObservation).not.toHaveBeenCalled();
      expect(memoryStore.findObservationByHash).not.toHaveBeenCalled();
      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.content).toBe(largeSkill);
      expect(result.metadata?.observationId).toBeUndefined();
    });

    it("rss_top 紧凑汇总不应创建 observation，避免隐藏日报所需标题", async () => {
      const largeRssSummary = Array.from(
        { length: 140 },
        (_, i) =>
          `## r/topic-${i}\n1. Title ${i}\n   https://reddit.com/r/topic/comments/${i}`,
      ).join("\n");
      expect(largeRssSummary.length).toBeGreaterThan(8_000);
      const testProvider = createMockProvider([
        createToolCallChunks("tc-rss", "rss_top", {
          feeds: ["technology"],
          topN: 5,
        }),
        finalChunks,
      ]);
      const rssTool = createMockTool("rss_top", { content: largeRssSummary });
      const testToolRegistry = createMockToolRegistry([rssTool]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream("reddit daily", "conv-rss"),
      );

      expect(memoryStore.addObservation).not.toHaveBeenCalled();
      const toolResult = events.find((event) => event.type === "tool_result")!;
      const result = (toolResult.data as { result: ToolResult }).result;
      expect(result.content).toBe(largeRssSummary);
      expect(result.metadata?.observationId).toBeUndefined();
    });

    it("工具失败后应允许同工具的修正参数重试", async () => {
      const sharedPrefix = "x".repeat(180);
      const firstInput = {
        action: "create",
        skillId: "online-gap-review",
        content: `${sharedPrefix}-missing-frontmatter`,
      };
      const correctedInput = {
        action: "create",
        skillId: "online-gap-review",
        content: `${sharedPrefix}-with-frontmatter`,
      };

      const firstCall: LLMStreamChunk[] = [
        {
          type: "tool_use_start",
          toolUse: { id: "tc-1", name: "skill_manage", input: "" },
        },
        {
          type: "tool_use_delta",
          toolUse: { id: "tc-1", name: "", input: JSON.stringify(firstInput) },
        },
        {
          type: "done",
          usage: { tokensIn: 10, tokensOut: 5 },
          model: "mock-model",
        },
      ];
      const correctedCall: LLMStreamChunk[] = [
        {
          type: "tool_use_start",
          toolUse: { id: "tc-2", name: "skill_manage", input: "" },
        },
        {
          type: "tool_use_delta",
          toolUse: {
            id: "tc-2",
            name: "",
            input: JSON.stringify(correctedInput),
          },
        },
        {
          type: "done",
          usage: { tokensIn: 10, tokensOut: 5 },
          model: "mock-model",
        },
      ];
      const finalChunks: LLMStreamChunk[] = [
        { type: "text", text: "已完成修正重试" },
        {
          type: "done",
          usage: { tokensIn: 20, tokensOut: 10 },
          model: "mock-model",
        },
      ];

      const testProvider = createMockProvider([
        firstCall,
        correctedCall,
        finalChunks,
      ]);
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          content: "Error: SKILL.md must start with YAML frontmatter",
          isError: true,
        })
        .mockResolvedValueOnce({ content: "created" });
      const skillManageTool: Tool = {
        name: "skill_manage",
        description: "manage skills",
        category: "builtin",
        parameters: { type: "object", properties: {} },
        execute,
      };
      const testToolRegistry = createMockToolRegistry([skillManageTool]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream("create skill", "conv-retry"),
      );

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenNthCalledWith(1, firstInput, undefined);
      expect(execute).toHaveBeenNthCalledWith(2, correctedInput, undefined);

      const toolResults = events.filter(
        (event) => event.type === "tool_result",
      );
      expect(toolResults).toHaveLength(2);
      expect(
        (toolResults[1].data as { result: ToolResult }).result.content,
      ).toBe("created");
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

      // 重复调用保护会优先拦截后续相同失败调用，避免反复执行同一个坏工具
      expect(buggyTool.execute).toHaveBeenCalledTimes(1);

      // 应有 response_complete
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
    });
    it("终端工具失败应立即停止，不再让 LLM 反复自救", async () => {
      const toolCallChunks: LLMStreamChunk[] = [
        {
          type: "tool_use_start",
          toolUse: { id: "tc-1", name: "delegate_tool", input: "" },
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
      const testProvider = createMockProvider([
        toolCallChunks,
        toolCallChunks,
        toolCallChunks,
      ]);
      const delegateTool = createMockTool("delegate_tool", {
        content: "外部委托工具不可用：claude 和 codex 都无法启动。",
        isError: true,
        metadata: { terminal: true, reason: "delegate_unavailable" },
      });
      const testToolRegistry = createMockToolRegistry([delegateTool]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream("写代码", "conv-terminal"),
      );

      expect(testProvider.stream).toHaveBeenCalledTimes(1);
      expect(delegateTool.execute).toHaveBeenCalledTimes(1);
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("外部委托工具不可用");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({ error: "terminal_tool_failure" }),
      );
    });

    it("达到全局工具调用上限后下一轮必须清空工具定义并强制合成", async () => {
      const firstRoundChunks: LLMStreamChunk[] = [];
      for (let i = 0; i < 41; i++) {
        firstRoundChunks.push(
          {
            type: "tool_use_start",
            toolUse: { id: `tc-${i}`, name: "probe_tool", input: "" },
          },
          {
            type: "tool_use_delta",
            toolUse: {
              id: `tc-${i}`,
              name: "",
              input: JSON.stringify({ index: i }),
            },
          },
        );
      }
      firstRoundChunks.push({
        type: "done",
        usage: { tokensIn: 10, tokensOut: 5 },
        model: "mock-model",
      });

      const capturedTools: string[][] = [];
      let callIndex = 0;
      const testProvider: LLMProvider = {
        name: "budget-provider",
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
        chat: vi.fn(),
        stream: vi.fn(async function* (request: LLMRequest) {
          capturedTools.push((request.tools ?? []).map((tool) => tool.name));
          if (callIndex === 0) {
            callIndex++;
            yield* firstRoundChunks;
            return;
          }
          callIndex++;
          yield {
            type: "tool_use_start",
            toolUse: { id: "tc-after-limit", name: "probe_tool", input: "" },
          } as LLMStreamChunk;
          yield {
            type: "tool_use_delta",
            toolUse: {
              id: "tc-after-limit",
              name: "",
              input: JSON.stringify({ index: 999 }),
            },
          } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"],
      };
      const probeTool = createMockTool("probe_tool", { content: "ok" });
      const testToolRegistry = createMockToolRegistry([probeTool]);
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: testToolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      await collectEvents(loop.runStream("probe", "conv-global-limit"));

      expect(capturedTools.length).toBeGreaterThanOrEqual(2);
      expect(capturedTools[0]).toContain("probe_tool");
      expect(capturedTools[1]).toEqual([]);
    });

    it("连续 max_tokens 且没有工具调用时应熔断，避免 687 秒空转", async () => {
      const truncatedChunks: LLMStreamChunk[] = [
        { type: "text", text: "我将创建页面，下面开始生成完整 HTML。" },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 8192 },
          model: "mock-model",
          stopReason: "max_tokens",
        },
      ];
      const testProvider = createMockProvider([
        truncatedChunks,
        truncatedChunks,
        truncatedChunks,
      ]);
      const continueHook = vi.fn().mockResolvedValue({
        action: "continue",
        hint: "还有未完成 todo，请继续。",
      });

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 5, maxTokens: 8192 },
      });

      const events = await collectEvents(
        loop.runStream("生成并发布页面", "conv-max-token", {
          toolHooks: { beforeReturn: continueHook },
        }),
      );

      expect(testProvider.stream).toHaveBeenCalledTimes(2);
      expect(continueHook).toHaveBeenCalledTimes(1);
      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(JSON.stringify(message.content)).toContain("连续 2 次输出被截断");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({ error: "llm_max_tokens_stalled" }),
      );
    });

    it("max_tokens with empty output should be saved as a trace error", async () => {
      const truncatedChunks: LLMStreamChunk[] = [
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 8192 },
          model: "mock-model",
          stopReason: "max_tokens",
        },
      ];
      const testProvider = createMockProvider([truncatedChunks]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 5, maxTokens: 8192 },
      });

      const events = await collectEvents(
        loop.runStream("生成并发布页面", "conv-max-token-empty"),
      );

      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(JSON.stringify(message.content)).toContain("max_tokens");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({ error: "llm_max_tokens_truncated" }),
      );
    });

    it("最终合成阶段输出伪工具 XML 时不得通过 response_chunk 泄漏给用户", async () => {
      const invalidToolMarkup =
        "<tool_call>\n<function=web_search>\n<parameter=query>AI news today 2026</parameter>\n</function>\n</tool_call>";
      const invalidChunks: LLMStreamChunk[] = [
        { type: "text", text: invalidToolMarkup },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const testProvider = createMockProvider([invalidChunks, invalidChunks]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry,
        contextManager,
        memoryStore,
        config: { maxIterations: 3 },
      });

      const events = await collectEvents(
        loop.runStream("在外网搜索今日AI界新闻生成简报", "conv-invalid-markup"),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).not.toContain("<tool_call>");
      expect(streamedText).not.toContain("<function=");
      expect(streamedText).toContain("不可执行的工具标记");
      expect(streamedText).not.toContain("工具预算已耗尽");

      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).not.toContain("<tool_call>");
      expect(String(message.content)).not.toContain("工具预算已耗尽");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({ error: "invalid_tool_markup_final" }),
      );
    });

    it("新闻简报拿到足够来源后应直接生成简报，不进入伪工具 XML 轮次", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-search-1", "web_search", {
          query: "AI news today May 21 2026",
        }),
        ...makeToolCallChunks("tc-search-2", "web_search", {
          query: "OpenAI Google DeepMind Anthropic news this week 2026",
        }),
        ...makeToolCallChunks("tc-search-3", "web_search", {
          query: "AI regulation policy May 2026",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const secondRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-fetch-1", "web_fetch", {
          url: "https://www.theverge.com/ai-artificial-intelligence",
        }),
        ...makeToolCallChunks("tc-fetch-2", "web_fetch", {
          url: "https://blog.mean.ceo/ai-advancements-news-may-2026/",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=web_fetch>\n<parameter=url>https://techcrunch.com/category/artificial-intelligence/</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const provider = createMockProvider([
        firstRoundChunks,
        secondRoundChunks,
        invalidChunks,
      ]);
      const webFetchExecute = vi.fn(async (input: Record<string, unknown>) => ({
        content: `Title: AI News Source\nURL Source: ${String(input.url)}\nNvidia reported record AI data center revenue. Intuit cut jobs to focus on AI services. AI regulation updates continue in May 2026.`,
      }));
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_search"),
            execute: vi.fn(async (input: Record<string, unknown>) => ({
              content: `results[3]{title,url}:\n  Nvidia data center revenue jumps on AI demand — ${String(input.query)}\n  https://www.theverge.com/ai-artificial-intelligence\n  White House releases AI policy framework — regulation update\n  https://www.whitehouse.gov/ai-policy\n  Anthropic publishes AI safety update — research update\n  https://www.anthropic.com/news/ai-safety-update`,
            })),
          },
          {
            ...createMockTool("web_fetch"),
            execute: webFetchExecute,
          },
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream("在外网搜索今日AI界新闻生成简报", "conv-news-direct"),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain("今日 AI 简报");
      expect(streamedText).toContain("来源链接");
      expect(streamedText).toContain("Nvidia data center revenue");
      expect(streamedText).toContain(
        "White House releases AI policy framework",
      );
      expect(streamedText).not.toContain("<tool_call>");
      expect(webFetchExecute).not.toHaveBeenCalled();
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it("SEO 检测表格任务拿到证据后应直接生成表格，不进入伪工具 XML 轮次", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-home", "web_fetch", {
          url: "https://www.ehafo.com",
        }),
        ...makeToolCallChunks("tc-robots", "web_fetch", {
          url: "https://www.ehafo.com/robots.txt",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=bash>\n<parameter=command>curl -sI https://www.ehafo.com</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const provider = createMockProvider([firstRoundChunks, invalidChunks]);
      const webFetchExecute = vi.fn(async (input: Record<string, unknown>) => {
        const url = String(input.url);
        return {
          content: url.endsWith("/robots.txt")
            ? "URL Source: https://www.ehafo.com/robots.txt\nUser-agent: *\nAllow: /\nSitemap: https://www.ehafo.com/sitemap.xml"
            : "URL Source: https://www.ehafo.com\n# 易哈佛医学考试题库 | 医护考试备考平台\n<meta name=\"description\" content=\"医学考试题库 医护考试备考\">\n## 热门医学考试备考入口\nviewport",
        };
      });
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_fetch"),
            execute: webFetchExecute,
          },
          createMockTool("web_search"),
          createMockTool("bash"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream(
          "对www.ehafo.com进行seo检测，表格方式输出",
          "conv-seo-detect-table-direct",
        ),
      );

      const completeEvent = events.find((event) => event.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      const responseText = String(message.content);
      expect(responseText).toContain("| 检查项 | 当前发现 | 判断 | 建议 | 证据 |");
      expect(responseText).toContain("Meta description");
      expect(responseText).not.toContain("<tool_call>");
      expect(provider.stream).toHaveBeenCalledTimes(1);
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
    });

    it("深度 SEO 追问应继承上一轮任务画像并在伪工具 XML 后合成表格", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-home", "web_fetch", {
          url: "https://www.ehafo.com",
        }),
        ...makeToolCallChunks("tc-robots", "web_fetch", {
          url: "https://www.ehafo.com/robots.txt",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=bash>\n<parameter=command>curl -sI https://www.ehafo.com</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const provider = createMockProvider([
        firstRoundChunks,
        invalidChunks,
        invalidChunks,
      ]);
      const longToolHistory = Array.from({ length: 18 }, (_, index) => ({
        id: `prev-tool-${index}`,
        conversationId: "conv-seo-depth-followup",
        role: "tool" as const,
        content: `previous tool result ${index}`,
        createdAt: new Date(`2026-06-18T00:${String(index + 2).padStart(2, "0")}:00Z`),
      }));
      const memoryStoreWithHistory = {
        ...memoryStore,
        getHistory: vi.fn().mockResolvedValue([
          {
            id: "prev-user",
            conversationId: "conv-seo-depth-followup",
            role: "user",
            content:
              "对www.ehafo.com，进行一轮全面、专业、详细的顶级专家级的seo检测，表格方式输出",
            createdAt: new Date("2026-06-18T00:00:00Z"),
          },
          {
            id: "prev-assistant",
            conversationId: "conv-seo-depth-followup",
            role: "assistant",
            content:
              "基于已成功获取的工具证据，先给出可复核的表格结论：\n| 检查项 | 当前发现 | 判断 | 建议 | 证据 |\n| --- | --- | --- | --- | --- |\n| 页面标题 | 易哈佛医学考试题库 | 已发现 | 继续扩展 | https://www.ehafo.com/ |",
            createdAt: new Date("2026-06-18T00:01:00Z"),
          },
          ...longToolHistory,
        ] as ConversationTurn[]),
      } as MemoryStore;
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_fetch"),
            execute: vi.fn(async (input: Record<string, unknown>) => {
              const url = String(input.url);
              return {
                content: url.endsWith("/robots.txt")
                  ? "URL Source: https://www.ehafo.com/robots.txt\nUser-agent: *\nAllow: /\nSitemap: https://www.ehafo.com/sitemap.xml"
                  : "URL Source: https://www.ehafo.com\n# 易哈佛医学考试题库 | 医护考试备考平台\n<meta name=\"description\" content=\"医学考试题库 医护考试备考\">\n## 热门医学考试备考入口\nviewport",
              };
            }),
          },
          createMockTool("web_search"),
          createMockTool("bash"),
        ]),
        contextManager,
        memoryStore: memoryStoreWithHistory,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream("是不是不够全面？", "conv-seo-depth-followup"),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain(
        "| 检查项 | 当前发现 | 判断 | 建议 | 证据 |",
      );
      expect(streamedText).not.toContain("<tool_call>");
      expect(memoryStoreWithHistory.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          steps: expect.arrayContaining([
            expect.objectContaining({
              type: "runtime_config",
              taskProfileKind: "evidence_table_analysis",
            }),
          ]),
        }),
      );
      expect(memoryStoreWithHistory.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
    });

    it("全面详细 SEO 审计应优先委托 claude_code 以获得深度报告", async () => {
      const claudeCodeTool = createMockTool("claude_code", {
        content:
          "# www.ehafo.com SEO 检测报告\n\n| 维度 | 发现 | 判断 | 建议 | 证据 |\n| --- | --- | --- | --- | --- |\n| 技术可抓取性 | HTTPS 可访问 | 通过 | 继续监控 | https://www.ehafo.com |\n| 结构化数据 | 发现 JSON-LD | 良好 | 补 BreadcrumbList | https://www.ehafo.com |\n| E-E-A-T | 有主体与资质线索 | 良好 | 补作者/审核人 | https://www.ehafo.com |",
      });
      const provider = createMockProvider([
        [
          { type: "text", text: "主模型不应被调用" },
          {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
          },
        ],
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([claudeCodeTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream(
          "对www.ehafo.com，进行一轮全面、专业、详细的顶级专家级的seo检测，表格方式输出",
          "conv-seo-deep-delegate",
        ),
      );

      const completeEvent = events.find((event) => event.type === "response_complete");
      expect(completeEvent).toBeDefined();
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toContain("结构化数据");
      expect(String(message.content)).toContain("E-E-A-T");
      expect(claudeCodeTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("顶级 SEO 审计专家"),
        }),
        undefined,
      );
      expect(provider.stream).not.toHaveBeenCalled();
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude_code",
        }),
      );
      const savedTrace = (memoryStore.addTrace as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Trace;
      expect(savedTrace.error).toBeUndefined();
    });

    it("claude_code 生成 Markdown 报告文件时应返回文件正文而不是摘要", async () => {
      const fullReport =
        "# www.ehafo.com 全面 SEO 审计报告\n\n| 检测项 | 状态 | 证据 / 说明 |\n| --- | --- | --- |\n| 技术可抓取性 | 通过 | HTTPS 可访问 |\n| 结构化数据 | 缺失 | 需补 BreadcrumbList |\n| E-E-A-T | 需补强 | 医疗教育类内容需作者/审核人 |";
      const claudeCodeTool: Tool = {
        ...createMockTool("claude_code"),
        execute: vi.fn(async (input: Record<string, unknown>) => {
          const cwd = String(input.cwd);
          mkdirSync(cwd, { recursive: true });
          const reportPath = `${cwd}/seo-audit-ehafo.md`;
          writeFileSync(reportPath, fullReport, "utf-8");
          return {
            content: `Claude Code completed.\nFiles changed: ${reportPath}\n报告已保存。`,
            isError: false,
          };
        }),
      };
      const provider = createMockProvider();
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([claudeCodeTool]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream(
          "对www.ehafo.com，进行一轮全面、专业、详细的顶级专家级的seo检测，表格方式输出",
          "conv-seo-deep-delegate-file",
        ),
      );

      const completeEvent = events.find((event) => event.type === "response_complete");
      const message = (completeEvent!.data as { message: Message }).message;
      expect(String(message.content)).toBe(fullReport);
      expect(String(message.content)).not.toContain("Files changed:");
      expect(provider.stream).not.toHaveBeenCalled();
    });

    it("新闻简报已写出文件后遇到禁用工具和伪工具标记应按成功成果收束", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const briefPath = "C:/Users/voroj/ai-news-brief-2026-05-24.md";
      const searchChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-search-1", "web_search", {
          query: "AI news today May 2026",
        }),
        ...makeToolCallChunks("tc-search-2", "web_search", {
          query: "OpenAI Google Anthropic AI news May 2026",
        }),
        ...makeToolCallChunks("tc-search-3", "web_search", {
          query: "AI safety regulation May 2026",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const writeChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-write", "file_write", {
          path: briefPath,
          content:
            "# AI 简报\n\n- OpenAI prepares IPO\n- Google launches Gemini update",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const blockedBashChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-bash", "bash", {
          command: "ping -n 4 8.8.8.8",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidMarkupChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=web_fetch>\n<parameter=url>https://example.com</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];

      const provider = createMockProvider([
        searchChunks,
        writeChunks,
        blockedBashChunks,
        invalidMarkupChunks,
        invalidMarkupChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_search"),
            execute: vi.fn(async (input: Record<string, unknown>) => ({
              content: `results[2]{title,url}:\n  AI News Today May 2026 — ${String(input.query)}\n  https://www.buildfastwithai.com/blogs/ai-news-today-may-18-2026\n  AI roundup on Medium\n  https://medium.com/@example/ai-news-week-of-may-2026`,
            })),
          },
          {
            ...createMockTool("file_write"),
            execute: vi.fn(async (input: Record<string, unknown>) => ({
              content: `Successfully wrote to ${String(input.path)}`,
              isError: false,
              metadata: {
                path: String(input.path),
                bytesWritten: Buffer.byteLength(String(input.content), "utf-8"),
              },
              effect: {
                kind: "write" as const,
                target: String(input.path),
                reversible: true,
                verified: true,
              },
            })),
          },
          createMockTool("bash"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 6 },
      });

      const events = await collectEvents(
        loop.runStream(
          "在外网搜索今日AI界新闻生成简报",
          "conv-news-written-file",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain("AI 新闻简报已生成");
      expect(streamedText).toContain(briefPath);
      expect(streamedText).not.toContain("<tool_call>");
      expect(streamedText).not.toContain("阶段性总结");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
    });

    it("新闻简报已写出文件后若继续结构化调工具应直接保留成果", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const briefPath = "C:/Users/voroj/ai-news-brief-force-synthesis.md";
      const searchChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-search-1", "web_search", {
          query: "AI news today May 2026",
        }),
        ...makeToolCallChunks("tc-search-2", "web_search", {
          query: "OpenAI Google Anthropic AI news May 2026",
        }),
        ...makeToolCallChunks("tc-search-3", "web_search", {
          query: "AI safety regulation May 2026",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const writeChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-write", "file_write", {
          path: briefPath,
          content: "# AI 简报\n\n- Google updates AI Search",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const blockedBashChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-bash", "bash", {
          command: "ping -n 4 google.com",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const suppressedToolChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-fetch-after-stop", "web_fetch", {
          url: "https://example.com/extra",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const webFetchExecute = vi.fn(async () => ({
        content: "should not execute",
      }));
      const provider = createMockProvider([
        searchChunks,
        writeChunks,
        blockedBashChunks,
        suppressedToolChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_search"),
            execute: vi.fn(async (input: Record<string, unknown>) => ({
              content: `results[2]{title,url}:\n  AI roundup — ${String(input.query)}\n  https://medium.com/@example/ai-roundup\n  AI video\n  https://www.youtube.com/watch?v=abc`,
            })),
          },
          {
            ...createMockTool("file_write"),
            execute: vi.fn(async (input: Record<string, unknown>) => ({
              content: `Successfully wrote to ${String(input.path)}`,
              isError: false,
              effect: {
                kind: "write" as const,
                target: String(input.path),
                reversible: true,
                verified: true,
              },
            })),
          },
          createMockTool("bash"),
          {
            ...createMockTool("web_fetch"),
            execute: webFetchExecute,
          },
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 6 },
      });

      const events = await collectEvents(
        loop.runStream(
          "在外网搜索今日AI界新闻生成简报",
          "conv-news-force-synthesis",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain("AI 新闻简报已生成");
      expect(streamedText).toContain(briefPath);
      expect(streamedText).not.toContain("阶段性总结");
      expect(webFetchExecute).not.toHaveBeenCalled();
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({
          error: "synthesis_only_tool_call_suppressed",
        }),
      );
    });

    it("新闻简报已发送文件后遇到伪工具标记应保留发送链接", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const writeAndSendChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-write", "file_write", {
          path: "brief.md",
          content: "# AI 简报\n\n- Sent artifact",
        }),
        ...makeToolCallChunks("tc-send", "send_file", {
          path: "brief.md",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidMarkupChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=web_fetch>\n<parameter=url>https://example.com</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const provider = createMockProvider([
        writeAndSendChunks,
        invalidMarkupChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("file_write"),
            execute: vi.fn(async (input: Record<string, unknown>) => ({
              content: `Successfully wrote to ${String(input.path)}`,
              isError: false,
              effect: {
                kind: "write" as const,
                target: String(input.path),
                reversible: true,
                verified: true,
              },
            })),
          },
          {
            ...createMockTool("send_file"),
            execute: vi.fn(
              async (
                _input: Record<string, unknown>,
                context?: ToolExecutionContext,
              ) => {
                context?.sentFiles?.push({
                  url: "/files/conv-news-sent-file/brief.md",
                  filename: "brief.md",
                });
                return {
                  content: "File sent: brief.md",
                  isError: false,
                  effect: {
                    kind: "send" as const,
                    target: "brief.md",
                    reversible: false,
                    deliverable: true,
                    verified: true,
                  },
                };
              },
            ),
          },
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream(
          "在外网搜索今日AI界新闻生成简报",
          "conv-news-sent-file",
          {
            sentFiles: [],
          },
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain("AI 新闻简报已生成");
      expect(streamedText).toContain(
        "[brief.md](/files/conv-news-sent-file/brief.md)",
      );
      expect(streamedText).not.toContain("<tool_call>");
      expect(streamedText).not.toContain("阶段性总结");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
    });

    it("AI 新闻简报应在搜索结果足够时过滤低质来源并避免撞 web_fetch 限流", async () => {
      const now = new Date();
      const currentDatePath = [
        String(now.getFullYear()).padStart(4, "0"),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("/");
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-search-1", "web_search", {
          query: "AI artificial intelligence news today 2026-05-23",
          max_results: 8,
        }),
        ...makeToolCallChunks("tc-search-2", "web_search", {
          query: "AI model release announcement May 2026",
          max_results: 8,
        }),
        ...makeToolCallChunks("tc-search-3", "web_search", {
          query: "AI industry funding regulation news this week May 2026",
          max_results: 8,
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const overFetchChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-fetch-1", "web_fetch", {
          url: "https://llm-stats.com/llm-updates",
        }),
        ...makeToolCallChunks("tc-fetch-2", "web_fetch", {
          url: "https://blog.mean.ceo/new-ai-model-releases-news-may-2026/",
        }),
        ...makeToolCallChunks("tc-fetch-3", "web_fetch", {
          url: "https://futureoflife.org/",
        }),
        ...makeToolCallChunks("tc-fetch-4", "web_fetch", {
          url: "https://www.transparencycoalition.ai/news/ai-legislative-update-may8-2026",
        }),
        ...makeToolCallChunks("tc-search-4", "web_search", {
          query: "AI news May 23 2026 latest",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const provider = createMockProvider([firstRoundChunks, overFetchChunks]);
      const webFetchExecute = vi.fn(async () => ({
        content: "should not be fetched",
      }));
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_search"),
            execute: vi.fn(async (input: Record<string, unknown>) => ({
              content:
                `results[5]{title,url}:\n` +
                `  What can we expect from AI in 2026? | The Current - YouTube — Artificial Intelligence exploded in 2025.\n` +
                `  https://www.youtube.com/watch?v=3w093nkLqCg\n` +
                `  White House releases AI policy framework — court rules update ${String(input.query)}\n` +
                `  https://www.whitehouse.gov/briefing-room/statements-releases/${currentDatePath}/ai-policy-framework/\n` +
                `  OpenAI releases agent update — product announcement ${String(input.query)}\n` +
                `  https://openai.com/news/agent-update\n` +
                `  Anthropic publishes AI safety update — research note ${String(input.query)}\n` +
                `  https://www.anthropic.com/news/ai-safety-update\n` +
                `  AI Updates Today (May 2026) – Latest AI Model Releases - LLM Stats — Track recent AI model releases.\n` +
                `  https://llm-stats.com/llm-updates\n` +
                `  New AI Model Releases News | May, 2026 (STARTUP EDITION) — startup opinion recap.\n` +
                `  https://blog.mean.ceo/new-ai-model-releases-news-may-2026/`,
            })),
          },
          {
            ...createMockTool("web_fetch"),
            execute: webFetchExecute,
          },
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream(
          "在外网搜索今日AI界新闻生成简报",
          "conv-ai-news-search-only",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain("今日 AI 简报");
      expect(streamedText).toContain(
        "White House releases AI policy framework",
      );
      expect(streamedText).not.toContain("LLM Stats");
      expect(streamedText).not.toContain("YouTube");
      expect(streamedText).not.toContain("blog.mean.ceo");
      expect(streamedText).not.toContain("You have called web_fetch");
      expect(streamedText).not.toContain("limit");
      expect(webFetchExecute).not.toHaveBeenCalled();
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it("Reddit RSS 定时任务抓取失败但已保存报告时应发送并完成，不进入伪工具 XML 轮次", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=web_search>\n<parameter=query>site:reddit.com/r/technology top today</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const reportPath =
        "D:/mycode/agentclaw/data/tmp/conv-rss-direct/reddit_tech_ai_daily.md";
      const sendFile = vi.fn().mockResolvedValue(undefined);
      const provider = createMockProvider([
        makeToolCallChunks("tc-rss", "rss_top", {
          feeds: ["r/technology", "r/artificial"],
          topN: 5,
          save_as: reportPath,
        }),
        invalidChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          createMockTool("rss_top", {
            content:
              "## r/technology\n- 抓取失败：HTTP 403 Blocked\n- https://www.reddit.com/r/technology/.rss\n\n## r/artificial\n- 抓取失败：HTTP 403 Blocked\n- https://www.reddit.com/r/artificial/.rss\n\nSaved to: D:/mycode/agentclaw/data/tmp/conv-rss-direct/reddit_tech_ai_daily.md",
            metadata: {
              filePath: reportPath,
              feeds: 2,
              saved: true,
            },
            effect: {
              kind: "write",
              target: reportPath,
              reversible: true,
              verified: true,
            },
          }),
          createMockTool("file_write"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream(
          "执行以下任务，生成一份中文科技/AI日报推送给主人：Reddit RSS 日报，最后用 send_file 发送",
          "conv-rss-direct",
          { sendFile },
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain("Reddit 科技AI日报");
      expect(streamedText).toContain("抓取失败");
      expect(streamedText).not.toContain("<tool_call>");
      expect(sendFile).toHaveBeenCalledWith(reportPath, basename(reportPath));
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it("Reddit RSS 定时任务未提供 save_as 时应由 agent loop 落盘并发送报告", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=web_fetch>\n<parameter=url>https://reddit.com/r/technology</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];
      const sentPaths: string[] = [];
      const sendFile = vi.fn(async (filePath: string) => {
        sentPaths.push(filePath);
      });
      const provider = createMockProvider([
        makeToolCallChunks("tc-rss", "rss_top", {
          feeds: ["r/technology", "r/artificial"],
          topN: 5,
        }),
        invalidChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          createMockTool("rss_top", {
            content:
              "## r/technology\n- 抓取失败：HTTP 403 Blocked\n- https://www.reddit.com/r/technology/.rss\n\n## r/artificial\n- 抓取失败：fetch failed\n- https://www.reddit.com/r/artificial/.rss",
          }),
          createMockTool("file_write"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      await collectEvents(
        loop.runStream(
          "执行以下任务，生成一份中文科技/AI日报推送给主人：Reddit RSS 日报，最后用 send_file 发送",
          "conv-rss-direct-write",
          { sendFile },
        ),
      );

      expect(sendFile).toHaveBeenCalledTimes(1);
      const sentPath = sentPaths[0].replace(/\\/g, "/");
      expect(sentPath).toContain(
        "data/tmp/conv-rss-direct-write/reddit-tech-ai-daily-",
      );
      expect(sentPath).toMatch(/\.md$/);
      expect(existsSync(sentPath)).toBe(true);
      expect(readFileSync(sentPath, "utf-8")).toContain("Reddit 科技AI日报");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          effects: expect.arrayContaining([
            expect.objectContaining({
              kind: "send",
              target: sentPath,
              deliverable: true,
            }),
          ]),
        }),
      );
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it("最终已成功交付时中途工具限流错误不应生成分支恢复建议", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const sentPaths: string[] = [];
      const sendFile = vi.fn(async (filePath: string) => {
        sentPaths.push(filePath);
      });
      const provider = createMockProvider([
        makeToolCallChunks("tc-rss-1", "rss_top", {
          feeds: ["r/technology"],
          topN: 5,
        }),
        makeToolCallChunks("tc-rss-2", "rss_top", {
          feeds: ["r/technology"],
          topN: 5,
        }),
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          createMockTool("rss_top", {
            content:
              "## r/technology\n1. Google CEO Sundar Pichai says AI will shape graduates' future (2026-05-24)\n   https://www.reddit.com/r/technology/comments/example",
          }),
          createMockTool("file_write"),
          createMockTool("send_file"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      await collectEvents(
        loop.runStream(
          "执行以下任务，生成一份中文科技/AI日报推送给主人：Reddit RSS 日报，最后用 send_file 发送",
          "conv-rss-limit-success",
          { sendFile },
        ),
      );

      expect(sendFile).toHaveBeenCalledTimes(1);
      expect(sentPaths[0].replace(/\\/g, "/")).toContain(
        "data/tmp/conv-rss-limit-success/reddit-tech-ai-daily-",
      );
      expect(readFileSync(sentPaths[0], "utf-8")).not.toContain(
        "You have called rss_top",
      );
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({
          branchRecovery: expect.anything(),
        }),
      );
    });

    it("SEO 表格任务获取足够事实后应直接合成表格，不进入伪工具 XML 轮次", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-home", "web_fetch", {
          url: "https://www.ehafo.com",
        }),
        ...makeToolCallChunks("tc-robots", "web_fetch", {
          url: "https://www.ehafo.com/robots.txt",
        }),
        ...makeToolCallChunks("tc-sitemap", "web_fetch", {
          url: "https://www.ehafo.com/sitemap.xml",
        }),
        ...makeToolCallChunks("tc-search", "web_search", {
          query: "site:ehafo.com",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidToolMarkup =
        "<tool_call>\n<function=bash>\n<parameter=command>curl -s https://www.ehafo.com/ | grep title</parameter>\n</function>\n</tool_call>";
      const invalidChunks: LLMStreamChunk[] = [
        { type: "text", text: invalidToolMarkup },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];

      const provider = createMockProvider([
        firstRoundChunks,
        invalidChunks,
        invalidChunks,
      ]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_fetch"),
            execute: vi.fn(async (input: Record<string, unknown>) => {
              const url = String(input.url ?? "");
              if (url.endsWith("/robots.txt")) {
                return {
                  content:
                    "URL Source: https://www.ehafo.com/robots.txt\n\nUser-agent: *\nDisallow:/.well-known/\nDisallow:/static/",
                };
              }
              if (url.endsWith("/sitemap.xml")) {
                return {
                  content:
                    "HTTP 404 Not Found for https://www.ehafo.com/sitemap.xml",
                  isError: true,
                  metadata: { timedOut: true },
                };
              }
              return {
                content:
                  "URL Source: https://www.ehafo.com\n\n# 易哈佛 | 全新医考进阶平台 - 品智知学出品\n\n## 品质教学\n\n## 核心拳头产品",
              };
            }),
          },
          createMockTool("web_search", {
            content:
              "results[2]{title,url}:\n  易哈佛| 全新医考进阶平台- 品智知学出品 — 在临床与生活的平衡中，手机已成为2000 万医护备考的主阵地。\n  https://www.ehafo.com/\n  医学考试指南- 全中国医学资格与职称考试一站式备考平台 - 易哈佛 — 覆盖全中国资格类与职称类医学考试的一站式指南。\n  https://www.ehafo.com/exam/",
          }),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream(
          "专业的检查www.ehafo.com 的seo，用表格回答。",
          "conv-seo-invalid-markup",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).not.toContain("<tool_call>");
      expect(streamedText).toContain(
        "| 检查项 | 当前发现 | 判断 | 建议 | 证据 |",
      );
      expect(streamedText).toContain("| 页面标题 |");
      expect(streamedText).toContain("| robots.txt |");
      expect(streamedText).toContain("| sitemap.xml |");
      expect(streamedText).toContain("sitemap.xml 返回 404");
      expect(streamedText).toContain("https://www.ehafo.com");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it("非 SEO 表格检查任务获取足够事实后也应直接合成通用证据表格", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-home", "web_fetch", {
          url: "https://www.example.com",
        }),
        ...makeToolCallChunks("tc-security", "web_fetch", {
          url: "https://www.example.com/.well-known/security.txt",
        }),
        ...makeToolCallChunks("tc-search", "web_search", {
          query: "site:example.com security",
        }),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=bash>\n<parameter=command>curl -sI https://www.example.com</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];

      const provider = createMockProvider([firstRoundChunks, invalidChunks]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("web_fetch"),
            execute: vi.fn(async (input: Record<string, unknown>) => {
              const url = String(input.url ?? "");
              if (url.includes("security.txt")) {
                return {
                  content:
                    "HTTP 404 Not Found for https://www.example.com/.well-known/security.txt",
                  isError: true,
                  metadata: { timedOut: true },
                };
              }
              return {
                content:
                  "Title: Example Domain\n\nURL Source: https://www.example.com/\n\nMarkdown Content:\n# Example Domain\n\nThis domain is for use in illustrative examples.",
              };
            }),
          },
          createMockTool("web_search", {
            content:
              "results[1]{title,url}:\n  Example Domain — This domain is for use in illustrative examples.\n  https://www.example.com/",
          }),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream(
          "检查www.example.com 的安全问题，用表格回答。",
          "conv-generic-table-analysis",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).not.toContain("<tool_call>");
      expect(streamedText).toContain(
        "| 检查项 | 当前发现 | 判断 | 建议 | 证据 |",
      );
      expect(streamedText).toContain("security.txt 返回 404");
      expect(streamedText).toContain("https://www.example.com");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it("表格化检查只有 bash 证据时也应直接合成通用证据表格", async () => {
      const makeToolCallChunks = (
        id: string,
        command: string,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name: "bash", input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify({ command }) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [
        ...makeToolCallChunks("tc-head", "curl -sI https://www.example.com"),
        ...makeToolCallChunks(
          "tc-security",
          "curl -sI https://www.example.com/.well-known/security.txt",
        ),
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "tool_use",
        },
      ];
      const invalidChunks: LLMStreamChunk[] = [
        {
          type: "text",
          text: "<tool_call>\n<function=bash>\n<parameter=command>curl -s https://www.example.com</parameter>\n</function>\n</tool_call>",
        },
        {
          type: "done",
          usage: { tokensIn: 100, tokensOut: 40 },
          model: "mock-model",
          stopReason: "end_turn",
        },
      ];

      const provider = createMockProvider([firstRoundChunks, invalidChunks]);
      const loop = new SimpleAgentLoop({
        provider,
        toolRegistry: createMockToolRegistry([
          {
            ...createMockTool("bash"),
            execute: vi.fn(async (input: Record<string, unknown>) => {
              const command = String(input.command ?? "");
              if (command.includes("security.txt")) {
                return {
                  content:
                    "HTTP/1.1 404 Not Found\nServer: cloudflare\nContent-Type: text/html\nURL Source: https://www.example.com/.well-known/security.txt",
                };
              }
              return {
                content:
                  "HTTP/1.1 200 OK\nServer: cloudflare\nContent-Type: text/html\nStrict-Transport-Security: max-age=31536000\nURL Source: https://www.example.com/",
              };
            }),
          },
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      const events = await collectEvents(
        loop.runStream(
          "检查www.example.com 的安全问题，用表格回答。",
          "conv-bash-only-table-analysis",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain(
        "| 检查项 | 当前发现 | 判断 | 建议 | 证据 |",
      );
      expect(streamedText).toContain("security.txt 返回 404");
      expect(streamedText).not.toContain("<tool_call>");
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
      expect(provider.stream).toHaveBeenCalledTimes(1);
    });

    it("合成阶段首次输出伪工具 XML 时应重试生成最终答复", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const firstRoundChunks: LLMStreamChunk[] = [];
      for (let i = 0; i < 4; i++) {
        firstRoundChunks.push(
          ...makeToolCallChunks(`tc-fetch-${i}`, "web_fetch", {
            url: `https://example.com/news-${i}`,
            max_chars: 4000,
          }),
        );
      }
      firstRoundChunks.push({
        type: "done",
        usage: { tokensIn: 100, tokensOut: 40 },
        model: "mock-model",
        stopReason: "tool_use",
      });

      const invalidToolMarkup =
        "<tool_call>\n<function=web_search>\n<parameter=query>more AI news</parameter>\n</function>\n</tool_call>";
      const finalAnswer =
        "主人，今日 AI 简报：OpenAI 发布广告平台；Meta 推进 agentic AI。";
      const testProvider = createMockProvider([
        firstRoundChunks,
        [
          { type: "text", text: invalidToolMarkup },
          {
            type: "done",
            usage: { tokensIn: 120, tokensOut: 30 },
            model: "mock-model",
            stopReason: "end_turn",
          },
        ],
        [
          { type: "text", text: finalAnswer },
          {
            type: "done",
            usage: { tokensIn: 130, tokensOut: 35 },
            model: "mock-model",
            stopReason: "end_turn",
          },
        ],
      ]);

      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("web_fetch", {
            content:
              "OpenAI launches self-serve advertising platform for ChatGPT.\nMeta reportedly develops advanced agentic AI assistant.",
          }),
          createMockTool("web_search"),
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 5 },
      });

      const events = await collectEvents(
        loop.runStream(
          "在外网搜索今日AI界新闻生成简报",
          "conv-invalid-markup-retry",
        ),
      );

      const streamedText = events
        .filter((event) => event.type === "response_chunk")
        .map((event) => (event.data as { text: string }).text)
        .join("");
      expect(streamedText).toContain(finalAnswer);
      expect(streamedText).not.toContain("<tool_call>");
      expect(streamedText).not.toContain("不可执行的工具标记");
      expect(testProvider.stream).toHaveBeenCalledTimes(3);
      expect(memoryStore.addTrace).toHaveBeenCalledWith(
        expect.not.objectContaining({ error: "invalid_tool_markup_final" }),
      );
    });

    it("天气查询只有月度气候片段时不应拦截后续 web_fetch", async () => {
      const makeToolCallChunks = (
        id: string,
        name: string,
        input: Record<string, unknown>,
      ): LLMStreamChunk[] => [
        { type: "tool_use_start", toolUse: { id, name, input: "" } },
        {
          type: "tool_use_delta",
          toolUse: { id, name: "", input: JSON.stringify(input) },
        },
      ];
      const testProvider = createMockProvider([
        [
          ...makeToolCallChunks("tc-search", "web_search", {
            query: "宁波明天天气 2026年5月17日",
            max_results: 3,
          }),
          {
            type: "done",
            usage: { tokensIn: 100, tokensOut: 20 },
            model: "mock-model",
            stopReason: "tool_use",
          },
        ],
        [
          ...makeToolCallChunks("tc-fetch", "web_fetch", {
            url: "https://www.accuweather.com/zh/cn/ningbo/61620/may-weather/61620",
            max_chars: 5000,
          }),
          {
            type: "done",
            usage: { tokensIn: 120, tokensOut: 20 },
            model: "mock-model",
            stopReason: "tool_use",
          },
        ],
        [
          { type: "text", text: "主人，宁波明天多云，23-28°C。" },
          {
            type: "done",
            usage: { tokensIn: 130, tokensOut: 25 },
            model: "mock-model",
            stopReason: "end_turn",
          },
        ],
      ]);
      const fetchTool = createMockTool("web_fetch", {
        content: "宁波 5月17日 天气：多云，23-28°C，东南风 3级。",
      });
      const loop = new SimpleAgentLoop({
        provider: testProvider,
        toolRegistry: createMockToolRegistry([
          createMockTool("web_search", {
            content:
              "results[3]{title,url}:\n  宁波五月, 2026 天气 — 29 4月. +25°+17°. 30 4月. +24°+17°. 1 5月. +25°+17°. 2 5月. +23°+16°.\n  https://www.meteoprog.com/cn/weather/Ningbo/month/may/\n\nhint: if the direct answer/snippets contain enough facts, answer from them with source links; use web_fetch(url) only when snippets are insufficient.",
          }),
          fetchTool,
        ]),
        contextManager,
        memoryStore,
        config: { maxIterations: 4 },
      });

      await collectEvents(
        loop.runStream("明天天气怎么样？", "conv-weather-monthly"),
      );

      expect(fetchTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://www.accuweather.com/zh/cn/ningbo/61620/may-weather/61620",
        }),
        undefined,
      );
    });
  });
});

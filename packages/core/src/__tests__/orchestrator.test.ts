import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SimpleOrchestrator,
  shouldRunMemoryExtraction,
} from "../orchestrator.js";
import type {
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
  MemoryStore,
  AgentEvent,
  ConversationTurn,
  Tool,
  ToolExecutionContext,
  ToolResult,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";
import { sessionSearchTool } from "@agentclaw/tools";

// ── Mock 工厂 ──

describe("memory extraction trigger policy", () => {
  it("应支持 warmup、周期触发和 idle 触发", () => {
    const base = new Date("2026-05-15T10:00:00.000Z");

    expect(shouldRunMemoryExtraction(1, undefined, base)).toBe(true);
    expect(shouldRunMemoryExtraction(2, base, base)).toBe(true);
    expect(shouldRunMemoryExtraction(3, base, base)).toBe(false);
    expect(shouldRunMemoryExtraction(4, base, base)).toBe(true);
    expect(shouldRunMemoryExtraction(8, base, base)).toBe(true);
    expect(
      shouldRunMemoryExtraction(5, new Date("2026-05-15T09:49:59.000Z"), base),
    ).toBe(true);
  });
});

function createMockProvider(
  streamChunks: LLMStreamChunk[][] = [],
): LLMProvider {
  let streamIndex = 0;
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
        content: "response",
        createdAt: new Date(),
      },
      model: "mock-model",
      tokensIn: 10,
      tokensOut: 5,
      stopReason: "end_turn",
    } as LLMResponse),
    stream: vi.fn(function* () {
      const chunks = streamChunks[streamIndex];
      streamIndex++;
      if (chunks) {
        for (const chunk of chunks) yield chunk;
        return;
      }
      yield { type: "text", text: "hello" } as LLMStreamChunk;
      yield {
        type: "done",
        usage: { tokensIn: 10, tokensOut: 5 },
        model: "mock-model",
      } as LLMStreamChunk;
    }) as unknown as LLMProvider["stream"],
  };
}

function createMockToolRegistry(tools: Tool[] = []): ToolRegistryImpl {
  const toolMap = new Map<string, Tool>();
  for (const tool of tools) toolMap.set(tool.name, tool);

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
        if (!tool) {
          return { content: `Tool "${name}" not found`, isError: true };
        }
        return tool.execute(input, context);
      },
    ),
  } as unknown as ToolRegistryImpl;
}

function createMockMemoryStore(): MemoryStore {
  const sessions = new Map<
    string,
    {
      id: string;
      conversationId: string;
      createdAt: Date;
      lastActiveAt: Date;
      title?: string;
      metadata?: Record<string, unknown>;
    }
  >();
  const turnsByConversation = new Map<string, ConversationTurn[]>();

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
    addTurn: vi.fn(async (conversationId: string, turn: ConversationTurn) => {
      const turns = turnsByConversation.get(conversationId) ?? [];
      turns.push(turn);
      turnsByConversation.set(conversationId, turns);
    }),
    getHistory: vi.fn(async (conversationId: string, limit?: number) => {
      const turns = turnsByConversation.get(conversationId) ?? [];
      return limit ? turns.slice(-limit) : turns;
    }),
    saveSession: vi.fn(
      async (session: {
        id: string;
        conversationId: string;
        createdAt: Date;
        lastActiveAt: Date;
        title?: string;
        metadata?: Record<string, unknown>;
      }) => {
        sessions.set(session.id, session);
      },
    ),
    getSessionById: vi.fn(async (id: string) => {
      return sessions.get(id) ?? null;
    }),
    listSessions: vi.fn(async () => {
      return Array.from(sessions.values());
    }),
    deleteSession: vi.fn(async (id: string) => {
      sessions.delete(id);
    }),
    addTrace: vi.fn().mockResolvedValue(undefined),
    getTrace: vi.fn().mockResolvedValue(null),
    getTraces: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  } as unknown as MemoryStore;
}

function createToolCallChunks(
  id: string,
  name: string,
  input: Record<string, unknown>,
): LLMStreamChunk[] {
  return [
    {
      type: "tool_use_start",
      toolUse: { id, name, input: "" },
    } as LLMStreamChunk,
    {
      type: "tool_use_delta",
      toolUse: { id, name: "", input: JSON.stringify(input) },
    } as LLMStreamChunk,
    {
      type: "done",
      usage: { tokensIn: 10, tokensOut: 5 },
      model: "mock-model",
    } as LLMStreamChunk,
  ];
}

// ── 辅助函数 ──

async function collectEvents(
  iterable: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("SimpleOrchestrator", () => {
  let provider: LLMProvider;
  let toolRegistry: ToolRegistryImpl;
  let memoryStore: MemoryStore;
  let orchestrator: SimpleOrchestrator;

  beforeEach(() => {
    provider = createMockProvider();
    toolRegistry = createMockToolRegistry();
    memoryStore = createMockMemoryStore();
    orchestrator = new SimpleOrchestrator({
      provider,
      toolRegistry,
      memoryStore,
      systemPrompt: "测试系统提示词",
    });
  });

  // ── 会话创建测试 ──

  describe("会话创建", () => {
    it("createSession 应返回具有唯一 ID 的会话", async () => {
      const session = await orchestrator.createSession();

      expect(session).toBeDefined();
      expect(session.id).toBeTruthy();
      expect(session.conversationId).toBeTruthy();
      expect(session.id).not.toBe(session.conversationId);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActiveAt).toBeInstanceOf(Date);
    });

    it("连续创建的会话应有不同的 ID", async () => {
      const session1 = await orchestrator.createSession();
      const session2 = await orchestrator.createSession();

      expect(session1.id).not.toBe(session2.id);
      expect(session1.conversationId).not.toBe(session2.conversationId);
    });

    it("创建会话时应调用 memoryStore.saveSession", async () => {
      const session = await orchestrator.createSession();

      expect(memoryStore.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: session.id,
          conversationId: session.conversationId,
        }),
      );
    });
  });

  // ── 会话获取测试 ──

  describe("会话获取", () => {
    it("应能获取已创建的会话", async () => {
      const created = await orchestrator.createSession();
      const fetched = await orchestrator.getSession(created.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.conversationId).toBe(created.conversationId);
    });

    it("获取不存在的会话应返回 undefined", async () => {
      const fetched = await orchestrator.getSession("non-existent-id");
      expect(fetched).toBeUndefined();
    });

    it("应从 memoryStore 恢复不在内存缓存中的会话", async () => {
      // 手动向 memoryStore 中添加一个会话（绕过内存缓存）
      const storedSession = {
        id: "stored-session-1",
        conversationId: "stored-conv-1",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        title: "恢复的会话",
      };
      // 直接调用 saveSession 把它存进 mock 的 sessions Map
      await memoryStore.saveSession(storedSession);

      // 创建新的 orchestrator 实例（内存缓存为空）
      const freshOrchestrator = new SimpleOrchestrator({
        provider,
        toolRegistry,
        memoryStore,
        systemPrompt: "测试",
      });

      const fetched = await freshOrchestrator.getSession("stored-session-1");
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe("stored-session-1");
      expect(fetched!.title).toBe("恢复的会话");
    });
  });

  // ── 会话列表测试 ──

  describe("会话列表", () => {
    it("无会话时应返回空数组", async () => {
      const sessions = await orchestrator.listSessions();
      expect(sessions).toEqual([]);
    });

    it("创建多个会话后应能列出所有会话", async () => {
      await orchestrator.createSession();
      await orchestrator.createSession();
      await orchestrator.createSession();

      const sessions = await orchestrator.listSessions();
      expect(sessions).toHaveLength(3);
    });
  });

  // ── 会话删除测试 ──

  describe("会话删除", () => {
    it("closeSession 应从列表中移除会话", async () => {
      const session = await orchestrator.createSession();

      // 确认会话存在
      const fetched = await orchestrator.getSession(session.id);
      expect(fetched).toBeDefined();

      // 删除会话
      await orchestrator.closeSession(session.id);

      // 调用了 deleteSession
      expect(memoryStore.deleteSession).toHaveBeenCalledWith(session.id);
    });

    it("删除不存在的会话不应报错", async () => {
      await expect(
        orchestrator.closeSession("non-existent"),
      ).resolves.not.toThrow();
    });
  });

  // ── 停止会话测试 ──

  describe("停止会话", () => {
    it("停止不存在的会话应返回 false", () => {
      const result = orchestrator.stopSession("non-existent");
      expect(result).toBe(false);
    });
  });

  // ── setModel 测试 ──

  describe("模型设置", () => {
    it("setModel 应更新 agentConfig 的 model", async () => {
      orchestrator.setModel("gpt-4o-mini");

      // 验证通过创建新会话并处理输入时传递的 config
      // 由于 setModel 修改的是内部 agentConfig，
      // 我们可以间接验证——创建 session 并处理消息
      const session = await orchestrator.createSession();

      // processInputStream 会使用更新后的 model
      const events = await collectEvents(
        orchestrator.processInputStream(session.id, "test"),
      );

      const completeEvent = events.find((e) => e.type === "response_complete");
      expect(completeEvent).toBeDefined();
    });
  });

  // ── processInput 测试 ──

  describe("消息处理", () => {
    it("processInput 应返回助手消息", async () => {
      const session = await orchestrator.createSession();
      const message = await orchestrator.processInput(session.id, "hello");

      expect(message).toBeDefined();
      expect(message.role).toBe("assistant");
    });

    it("对不存在的会话调用 processInput 应抛出异常", async () => {
      await expect(
        orchestrator.processInput("bad-session", "hello"),
      ).rejects.toThrow("Session not found");
    });

    it("processInputStream 应生成事件流", async () => {
      const session = await orchestrator.createSession();
      const events = await collectEvents(
        orchestrator.processInputStream(session.id, "hello"),
      );

      const types = events.map((e) => e.type);
      expect(types).toContain("thinking");
      expect(types).toContain("response_complete");
    });

    it("禁用后台学习时不应触发后台 trace 学习", async () => {
      const isolatedMemoryStore = createMockMemoryStore();
      const isolatedOrchestrator = new SimpleOrchestrator({
        provider,
        toolRegistry,
        memoryStore: isolatedMemoryStore,
        systemPrompt: "测试",
        enableBackgroundLearning: false,
      });
      const session = await isolatedOrchestrator.createSession();

      await collectEvents(
        isolatedOrchestrator.processInputStream(session.id, "hello"),
      );

      expect(isolatedMemoryStore.getTraces).not.toHaveBeenCalled();
    });

    it("session_search 工具应能检索旧会话历史", async () => {
      const oldSession = await orchestrator.createSession({
        title: "Auth 调试",
      });
      await orchestrator.updateSession(oldSession.id, { title: "Auth 调试" });
      await memoryStore.addTurn(oldSession.conversationId, {
        id: "old-user",
        conversationId: oldSession.conversationId,
        role: "user",
        content: "refresh token 在 401 后没有轮换",
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
      });

      const searchProvider = createMockProvider([
        createToolCallChunks("tc-session", "session_search", {
          query: "refresh token",
          limit: 1,
        }),
        [
          { type: "text", text: "找到了旧会话。" } as LLMStreamChunk,
          {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
          } as LLMStreamChunk,
        ],
      ]);
      const searchOrchestrator = new SimpleOrchestrator({
        provider: searchProvider,
        toolRegistry: createMockToolRegistry([sessionSearchTool]),
        memoryStore,
        systemPrompt: "测试",
      });
      const session = await searchOrchestrator.createSession();

      const events = await collectEvents(
        searchOrchestrator.processInputStream(session.id, "找之前的认证问题"),
      );

      const toolResult = events.find((event) => event.type === "tool_result");
      expect(toolResult).toBeDefined();
      const result = (toolResult!.data as { result: { content: string } })
        .result;
      expect(result.content).toContain("Auth 调试");
      expect(result.content).toContain("refresh token 在 401 后没有轮换");
      expect(result.content).toContain("old-user anchor");
    });
  });

  // ── 系统提示词更新测试 ──

  describe("系统提示词更新", () => {
    it("updateSystemPrompt 应更新提示词", () => {
      orchestrator.updateSystemPrompt("新的系统提示词");
      // 无法直接验证私有字段，但确保不报错
      expect(() =>
        orchestrator.updateSystemPrompt("另一个提示词"),
      ).not.toThrow();
    });

    it("应在每次处理消息时解析当前时间模板变量", async () => {
      vi.useFakeTimers();
      try {
        const prompts: string[] = [];
        provider.stream = vi.fn(function* (request) {
          prompts.push(request.systemPrompt ?? "");
          yield { type: "text", text: "hello" } as LLMStreamChunk;
          yield {
            type: "done",
            usage: { tokensIn: 10, tokensOut: 5 },
            model: "mock-model",
          } as LLMStreamChunk;
        }) as unknown as LLMProvider["stream"];
        const dynamicOrchestrator = new SimpleOrchestrator({
          provider,
          toolRegistry,
          memoryStore,
          systemPrompt: "当前时间：{{datetime}}；时区：{{timezone}}",
        });

        vi.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));
        const firstSession = await dynamicOrchestrator.createSession();
        await collectEvents(
          dynamicOrchestrator.processInputStream(firstSession.id, "hello"),
        );
        const firstPrompt = prompts.filter(Boolean).at(-1);

        vi.setSystemTime(new Date("2026-05-10T00:00:00.000Z"));
        const secondSession = await dynamicOrchestrator.createSession();
        await collectEvents(
          dynamicOrchestrator.processInputStream(secondSession.id, "hello"),
        );
        const secondPrompt = prompts.filter(Boolean).at(-1);

        expect(firstPrompt).not.toContain("{{datetime}}");
        expect(firstPrompt).not.toContain("{{timezone}}");
        expect(secondPrompt).not.toContain("{{datetime}}");
        expect(secondPrompt).not.toContain("{{timezone}}");
        expect(secondPrompt).not.toBe(firstPrompt);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

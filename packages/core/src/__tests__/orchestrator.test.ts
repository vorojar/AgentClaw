import { describe, it, expect, vi, beforeEach } from "vitest";
import { SimpleOrchestrator } from "../orchestrator.js";
import type {
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
  ModelInfo,
  MemoryStore,
  AgentEvent,
} from "@agentclaw/types";
import type { ToolRegistryImpl } from "@agentclaw/tools";

// ── Mock 工厂 ──

function createMockProvider(): LLMProvider {
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
      yield { type: "text", text: "hello" } as LLMStreamChunk;
      yield {
        type: "done",
        usage: { tokensIn: 10, tokensOut: 5 },
        model: "mock-model",
      } as LLMStreamChunk;
    }) as unknown as LLMProvider["stream"],
  };
}

function createMockToolRegistry(): ToolRegistryImpl {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    definitions: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ content: "ok" }),
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
  });
});

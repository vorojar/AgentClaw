import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSessionRoutes } from "../routes/sessions.js";
import { registerConfigRoutes } from "../routes/config.js";
import type { AppContext } from "../bootstrap.js";

/**
 * 创建 mock AppContext，只包含测试需要的最小依赖
 */
function createMockContext(overrides: Partial<AppContext> = {}): AppContext {
  return {
    provider: {} as any,
    orchestrator: {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn(),
      closeSession: vi.fn(),
      processInput: vi.fn(),
      processInputStream: vi.fn(),
      setSystemPrompt: vi.fn(),
      setModel: vi.fn(),
    } as any,
    toolRegistry: {} as any,
    memoryStore: {
      getHistory: vi.fn(),
      saveSession: vi.fn(),
      getUsageStats: vi.fn(),
    } as any,
    skillRegistry: {} as any,
    config: {
      provider: "mock-provider",
      model: "mock-model",
      databasePath: ":memory:",
      skillsDir: "./skills",
    },
    scheduler: {} as any,
    agents: [],
    refreshAgents: vi.fn(),
    refreshHealth: vi.fn(),
  } as any;
}

describe("Session 路由", () => {
  let app: FastifyInstance;
  let ctx: AppContext;

  beforeEach(async () => {
    ctx = createMockContext();
    app = Fastify({ logger: false });
    registerSessionRoutes(app, ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/sessions", () => {
    it("创建新会话并返回序列化结果", async () => {
      const mockSession = {
        id: "session-1",
        conversationId: "conv-1",
        createdAt: new Date("2025-01-01T00:00:00Z"),
        lastActiveAt: new Date("2025-01-01T00:00:00Z"),
        title: undefined,
        metadata: { agentId: "default" },
      };
      (ctx.orchestrator.createSession as any).mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe("session-1");
      expect(body.conversationId).toBe("conv-1");
      expect(body.createdAt).toBe("2025-01-01T00:00:00.000Z");
      expect(body.agentId).toBe("default");
    });

    it("可以指定 agentId 创建会话", async () => {
      const mockSession = {
        id: "session-2",
        conversationId: "conv-2",
        createdAt: new Date("2025-01-01T00:00:00Z"),
        lastActiveAt: new Date("2025-01-01T00:00:00Z"),
        metadata: { agentId: "custom-agent" },
      };
      (ctx.orchestrator.createSession as any).mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { agentId: "custom-agent" },
      });

      expect(res.statusCode).toBe(200);
      expect(ctx.orchestrator.createSession).toHaveBeenCalledWith({
        agentId: "custom-agent",
      });
      expect(res.json().agentId).toBe("custom-agent");
    });

    it("orchestrator 抛错时返回 500", async () => {
      (ctx.orchestrator.createSession as any).mockRejectedValue(
        new Error("DB connection failed"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("DB connection failed");
    });
  });

  describe("GET /api/sessions", () => {
    it("返回会话列表", async () => {
      const mockSessions = [
        {
          id: "s1",
          conversationId: "c1",
          createdAt: new Date("2025-01-01"),
          lastActiveAt: new Date("2025-01-02"),
          title: "会话一",
          metadata: { agentId: "default" },
        },
        {
          id: "s2",
          conversationId: "c2",
          createdAt: new Date("2025-01-03"),
          lastActiveAt: new Date("2025-01-04"),
          title: "会话二",
          metadata: {},
        },
      ];
      (ctx.orchestrator.listSessions as any).mockResolvedValue(mockSessions);

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe("s1");
      expect(body[0].title).toBe("会话一");
      expect(body[0].agentId).toBe("default");
      // 没有 agentId 时默认 "default"
      expect(body[1].agentId).toBe("default");
    });

    it("空列表返回空数组", async () => {
      (ctx.orchestrator.listSessions as any).mockResolvedValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("DELETE /api/sessions/:id", () => {
    it("成功关闭会话返回 204", async () => {
      (ctx.orchestrator.closeSession as any).mockResolvedValue(undefined);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/sessions/session-1",
      });

      expect(res.statusCode).toBe(204);
      expect(ctx.orchestrator.closeSession).toHaveBeenCalledWith("session-1");
    });
  });

  describe("GET /api/sessions/:id/history", () => {
    it("返回会话历史消息", async () => {
      const mockSession = {
        id: "s1",
        conversationId: "conv-1",
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
      (ctx.orchestrator.getSession as any).mockResolvedValue(mockSession);

      const mockTurns = [
        {
          role: "user",
          content: "你好",
          createdAt: new Date("2025-01-01T00:00:00Z"),
        },
        {
          role: "assistant",
          content: "你好！有什么可以帮助你的？",
          model: "mock-model",
          tokensIn: 10,
          tokensOut: 20,
          createdAt: new Date("2025-01-01T00:00:01Z"),
        },
      ];
      (ctx.memoryStore.getHistory as any).mockResolvedValue(mockTurns);

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/s1/history",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].role).toBe("user");
      expect(body[0].content).toBe("你好");
      expect(body[1].model).toBe("mock-model");
    });

    it("会话不存在时返回 404", async () => {
      (ctx.orchestrator.getSession as any).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/nonexistent/history",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("Session not found");
    });
  });
});

describe("Config 路由", () => {
  let app: FastifyInstance;
  let ctx: AppContext;

  beforeEach(async () => {
    ctx = createMockContext();
    app = Fastify({ logger: false });
    registerConfigRoutes(app, ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/config", () => {
    it("返回当前配置", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/config",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.provider).toBe("mock-provider");
      expect(body.model).toBe("mock-model");
      expect(body.databasePath).toBe(":memory:");
      expect(body.skillsDir).toBe("./skills");
    });
  });

  describe("GET /api/stats", () => {
    it("返回使用统计", async () => {
      (ctx.memoryStore.getUsageStats as any).mockReturnValue({
        totalIn: 1000,
        totalOut: 500,
        totalCalls: 10,
        byModel: [
          {
            model: "mock-model",
            totalIn: 1000,
            totalOut: 500,
            callCount: 10,
          },
        ],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/stats",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalInputTokens).toBe(1000);
      expect(body.totalOutputTokens).toBe(500);
      expect(body.totalCalls).toBe(10);
      expect(body.byModel).toHaveLength(1);
      expect(body.byModel[0].model).toBe("mock-model");
    });
  });

  describe("PUT /api/config", () => {
    it("更新模型配置", async () => {
      const mockOrchestrator = ctx.orchestrator as any;
      mockOrchestrator.setModel = vi.fn();

      const res = await app.inject({
        method: "PUT",
        url: "/api/config",
        payload: { model: "new-model" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.model).toBe("new-model");
      expect(ctx.config.model).toBe("new-model");
    });
  });
});

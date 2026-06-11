import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerSessionRoutes } from "../routes/sessions.js";
import { registerConfigRoutes } from "../routes/config.js";
import { registerToolRoutes } from "../routes/tools.js";
import { registerPreviewRoutes } from "../routes/preview.js";
import { registerMemoryRoutes } from "../routes/memories.js";
import type { AppContext } from "../bootstrap.js";
import { initDatabase, SQLiteMemoryStore } from "@agentclaw/memory";

/**
 * 创建 mock AppContext，只包含测试需要的最小依赖
 */
function createMockContext(_overrides: Partial<AppContext> = {}): AppContext {
  const base = {
    provider: {} as any,
    orchestrator: {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn(),
      getSessionTree: vi.fn(),
      setSessionActiveLeaf: vi.fn(),
      closeSession: vi.fn(),
      processInput: vi.fn(),
      processInputStream: vi.fn(),
      setProvider: vi.fn(),
      setSystemPrompt: vi.fn(),
      setModel: vi.fn(),
    } as any,
    toolRegistry: {} as any,
    memoryStore: {
      getHistory: vi.fn(),
      getTraces: vi.fn(),
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
  return { ...base, ..._overrides } as AppContext;
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
        channel: "web",
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

  describe("Session tree routes", () => {
    it("GET /api/sessions/:id/tree 返回完整会话树", async () => {
      (ctx.orchestrator.getSessionTree as any).mockResolvedValue({
        conversationId: "conv-1",
        activeLeafId: "turn-b",
        turns: [
          {
            id: "turn-root",
            conversationId: "conv-1",
            parentId: null,
            branchId: "main",
            role: "user",
            content: "做一个方案",
            createdAt: new Date("2026-05-23T10:00:00Z"),
          },
          {
            id: "turn-b",
            conversationId: "conv-1",
            parentId: "turn-root",
            branchId: "main",
            role: "assistant",
            content: "方案 B",
            createdAt: new Date("2026-05-23T10:01:00Z"),
          },
        ],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/s1/tree",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        conversationId: "conv-1",
        activeLeafId: "turn-b",
        turns: [
          { id: "turn-root", parentId: null, content: "做一个方案" },
          { id: "turn-b", parentId: "turn-root", content: "方案 B" },
        ],
      });
      expect(ctx.orchestrator.getSessionTree).toHaveBeenCalledWith("s1");
    });

    it("POST /api/sessions/:id/active-leaf 切换 active leaf", async () => {
      (ctx.orchestrator.setSessionActiveLeaf as any).mockResolvedValue({
        conversationId: "conv-1",
        activeLeafId: "turn-root",
        turns: [
          {
            id: "turn-root",
            conversationId: "conv-1",
            parentId: null,
            branchId: "main",
            role: "user",
            content: "做一个方案",
            createdAt: new Date("2026-05-23T10:00:00Z"),
          },
        ],
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/s1/active-leaf",
        payload: { turnId: "turn-root" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().activeLeafId).toBe("turn-root");
      expect(ctx.orchestrator.setSessionActiveLeaf).toHaveBeenCalledWith(
        "s1",
        "turn-root",
      );
    });
  });

  describe("GET /api/sessions/:id/recovery-suggestions", () => {
    it("返回当前 session 的分支恢复建议", async () => {
      (ctx.orchestrator.getSession as any).mockResolvedValue({
        id: "s1",
        conversationId: "conv-1",
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });
      (ctx.memoryStore.getTraces as any).mockResolvedValue({
        total: 2,
        items: [
          {
            id: "trace-2",
            conversationId: "conv-1",
            userInput: "retry",
            steps: [],
            tokensIn: 1,
            tokensOut: 1,
            durationMs: 1,
            createdAt: new Date("2026-05-23T12:00:02Z"),
            branchRecovery: {
              traceId: "trace-2",
              conversationId: "conv-1",
              fromTurnId: "turn-user-1",
              reason: "tool_error",
              message: "可以从本轮用户输入重新开一个分支。",
              failedToolNames: ["bash"],
              createdAt: new Date("2026-05-23T12:00:02Z"),
            },
          },
          {
            id: "trace-1",
            conversationId: "conv-1",
            userInput: "ok",
            steps: [],
            tokensIn: 1,
            tokensOut: 1,
            durationMs: 1,
            createdAt: new Date("2026-05-23T12:00:01Z"),
          },
        ],
      });
      (ctx.memoryStore.getHistory as any).mockResolvedValue([
        {
          id: "turn-user-1",
          conversationId: "conv-1",
          role: "user",
          content: "retry",
          createdAt: new Date("2026-05-23T12:00:00Z"),
        },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/s1/recovery-suggestions",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        expect.objectContaining({
          traceId: "trace-2",
          fromTurnId: "turn-user-1",
          reason: "tool_error",
          failedToolNames: ["bash"],
        }),
      ]);
      expect(ctx.memoryStore.getTraces).toHaveBeenCalledWith(
        50,
        0,
        undefined,
        "conv-1",
      );
    });

    it("不返回已经离开 active branch 的恢复建议", async () => {
      (ctx.orchestrator.getSession as any).mockResolvedValue({
        id: "s1",
        conversationId: "conv-1",
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });
      (ctx.memoryStore.getTraces as any).mockResolvedValue({
        total: 1,
        items: [
          {
            id: "trace-1",
            conversationId: "conv-1",
            userInput: "failed",
            steps: [],
            tokensIn: 1,
            tokensOut: 1,
            durationMs: 1,
            createdAt: new Date("2026-05-23T12:00:01Z"),
            branchRecovery: {
              traceId: "trace-1",
              conversationId: "conv-1",
              fromTurnId: "old-failed-user",
              reason: "tool_error",
              message: "可以从本轮用户输入重新开一个分支。",
              failedToolNames: ["bash"],
              createdAt: new Date("2026-05-23T12:00:01Z"),
            },
          },
        ],
      });
      (ctx.memoryStore.getHistory as any).mockResolvedValue([
        {
          id: "new-recovery-user",
          conversationId: "conv-1",
          role: "user",
          content: "recovered",
          createdAt: new Date("2026-05-23T12:00:02Z"),
        },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/s1/recovery-suggestions",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("POST /api/sessions/:id/recover-branch", () => {
    it("用失败用户轮次的父节点创建替换分支", async () => {
      (ctx.orchestrator.getSession as any).mockResolvedValue({
        id: "s1",
        conversationId: "conv-1",
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });
      (ctx.orchestrator.getSessionTree as any)
        .mockResolvedValueOnce({
          conversationId: "conv-1",
          activeLeafId: "failed-assistant",
          turns: [
            {
              id: "parent-user",
              conversationId: "conv-1",
              parentId: null,
              branchId: "main",
              role: "user",
              content: "上一个稳定问题",
              createdAt: new Date("2026-05-23T12:00:00Z"),
            },
            {
              id: "failed-user",
              conversationId: "conv-1",
              parentId: "parent-user",
              branchId: "main",
              role: "user",
              content: "失败请求",
              createdAt: new Date("2026-05-23T12:00:01Z"),
            },
          ],
        })
        .mockResolvedValueOnce({
          conversationId: "conv-1",
          activeLeafId: "new-assistant",
          turns: [],
        });
      (ctx.orchestrator.processInput as any).mockResolvedValue({
        id: "new-assistant",
        role: "assistant",
        content: "恢复完成",
        createdAt: new Date("2026-05-23T12:00:02Z"),
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/s1/recover-branch",
        payload: {
          fromTurnId: "failed-user",
          content: "替换失败请求重新执行",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().tree.activeLeafId).toBe("new-assistant");
      expect(ctx.orchestrator.processInput).toHaveBeenCalledWith(
        "s1",
        "替换失败请求重新执行",
        expect.objectContaining({
          conversationParentTurnId: "parent-user",
          conversationBranchId: "recovery:failed-user",
        }),
      );
    });
  });

  describe("POST /api/sessions/:id/auto-recover-branch", () => {
    it("自动恢复时替换失败用户轮次并禁用失败工具", async () => {
      (ctx.orchestrator.getSession as any).mockResolvedValue({
        id: "s1",
        conversationId: "conv-1",
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });
      (ctx.orchestrator.getSessionTree as any)
        .mockResolvedValueOnce({
          conversationId: "conv-1",
          activeLeafId: "failed-assistant",
          turns: [
            {
              id: "failed-user",
              conversationId: "conv-1",
              parentId: null,
              branchId: "main",
              role: "user",
              content: "请列目录",
              createdAt: new Date("2026-05-23T12:00:00Z"),
            },
          ],
        })
        .mockResolvedValueOnce({
          conversationId: "conv-1",
          activeLeafId: "new-assistant",
          turns: [],
        });
      (ctx.memoryStore.getTraces as any).mockResolvedValue({
        total: 1,
        items: [
          {
            id: "trace-1",
            conversationId: "conv-1",
            userInput: "请列目录",
            steps: [],
            tokensIn: 1,
            tokensOut: 1,
            durationMs: 1,
            createdAt: new Date("2026-05-23T12:00:01Z"),
            branchRecovery: {
              traceId: "trace-1",
              conversationId: "conv-1",
              fromTurnId: "failed-user",
              reason: "tool_error",
              message: "可以从本轮用户输入重新开一个分支。",
              failedToolNames: ["bash"],
              createdAt: new Date("2026-05-23T12:00:01Z"),
            },
          },
        ],
      });
      (ctx.orchestrator.processInput as any).mockResolvedValue({
        id: "new-assistant",
        role: "assistant",
        content: "已换路径恢复",
        createdAt: new Date("2026-05-23T12:00:02Z"),
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/s1/auto-recover-branch",
        payload: { fromTurnId: "failed-user" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deniedTools).toEqual(["bash"]);
      expect(ctx.orchestrator.processInput).toHaveBeenCalledWith(
        "s1",
        expect.stringContaining("本轮禁止再调用这些失败工具"),
        expect.objectContaining({
          conversationParentTurnId: null,
          conversationBranchId: "auto-recovery:failed-user",
          originalUserText:
            "[自动恢复分支] 已从失败路径换路恢复；本轮禁用失败工具：bash。",
          toolPolicy: { deny: ["bash"] },
        }),
      );
    });
  });
});

describe("Config 路由", () => {
  let app: FastifyInstance;
  let ctx: AppContext;
  let configDir: string;
  let previousConfigPath: string | undefined;

  beforeEach(async () => {
    previousConfigPath = process.env.CONFIG_PATH;
    configDir = mkdtempSync(path.join(tmpdir(), "agentclaw-routes-"));
    process.env.CONFIG_PATH = path.join(configDir, "config.json");
    ctx = createMockContext();
    app = Fastify({ logger: false });
    registerConfigRoutes(app, ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (previousConfigPath === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = previousConfigPath;
    }
    rmSync(configDir, { recursive: true, force: true });
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
      expect(body).not.toHaveProperty("anthropicApiKey");
      expect(body).not.toHaveProperty("openaiApiKey");
      expect(body).not.toHaveProperty("openaiBaseUrl");
      expect(body).not.toHaveProperty("geminiApiKey");
      expect(body).not.toHaveProperty("defaultModel");
      expect(body).not.toHaveProperty("anthropicModel");
      expect(body).not.toHaveProperty("openaiModel");
      expect(body).not.toHaveProperty("geminiModel");
      expect(body).not.toHaveProperty("searxngUrl");
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

describe("Tool 路由", () => {
  let app: FastifyInstance;
  let ctx: AppContext;

  beforeEach(async () => {
    ctx = createMockContext({
      toolRegistry: {
        list: vi.fn().mockReturnValue([]),
      } as any,
      skillRegistry: {
        list: vi.fn().mockReturnValue([]),
      } as any,
      memoryStore: {
        listSkillUsageStats: vi.fn().mockResolvedValue([]),
        listSkillChangeHistory: vi.fn().mockResolvedValue([]),
        listEvolutionRuns: vi.fn().mockResolvedValue([
          {
            id: "run-1",
            targetType: "skill",
            targetId: "writer",
            status: "verified",
            result: "improved",
            regressionCount: 0,
            startedAt: new Date("2026-04-01T00:00:00Z"),
            createdAt: new Date("2026-04-01T00:00:00Z"),
            updatedAt: new Date("2026-04-01T00:01:00Z"),
          },
        ]),
        listEvolutionEvents: vi.fn().mockResolvedValue([
          {
            id: "event-1",
            runId: "run-1",
            eventType: "online_regression",
            success: true,
            traceId: "trace-1",
            data: { passed: 5, total: 5 },
            createdAt: new Date("2026-04-01T00:01:00Z"),
          },
        ]),
      } as any,
    });
    app = Fastify({ logger: false });
    registerToolRoutes(app, ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("返回 evolution run 列表并支持 target 过滤", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/evolution/runs?targetType=skill&targetId=writer&triggerTraceId=trace-1&limit=10",
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.memoryStore.listEvolutionRuns).toHaveBeenCalledWith({
      targetType: "skill",
      targetId: "writer",
      status: undefined,
      triggerTraceId: "trace-1",
      triggerConversationId: undefined,
      limit: 10,
    });
    expect(res.json()[0]).toMatchObject({
      id: "run-1",
      targetType: "skill",
      targetId: "writer",
      status: "verified",
    });
  });

  it("返回指定 run 的 evolution event 列表", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/evolution/events?runId=run-1&traceId=trace-1&limit=20",
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.memoryStore.listEvolutionEvents).toHaveBeenCalledWith({
      runId: "run-1",
      traceId: "trace-1",
      limit: 20,
    });
    expect(res.json()[0]).toMatchObject({
      id: "event-1",
      runId: "run-1",
      eventType: "online_regression",
      success: true,
    });
  });
});

describe("Memory 路由", () => {
  let app: FastifyInstance;
  let ctx: AppContext;
  let db: ReturnType<typeof initDatabase>;
  let store: SQLiteMemoryStore;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    store = new SQLiteMemoryStore(db);
    ctx = createMockContext({ memoryStore: store as any });
    app = Fastify({ logger: false });
    registerMemoryRoutes(app, ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("PATCH /api/memories/:id 应更新内容、重要性并保留 metadata", async () => {
    const memory = await store.add({
      type: "preference",
      content: "用户偏好深色 PPTX。",
      importance: 0.7,
      metadata: { layer: "L1", confidence: 0.9 },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/memories/${memory.id}`,
      payload: {
        content: "用户偏好白底蓝色 PPTX。",
        importance: 0.95,
        metadata: { reason: "manual correction" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: memory.id,
      content: "用户偏好白底蓝色 PPTX。",
      importance: 0.95,
      metadata: {
        layer: "L1",
        confidence: 0.9,
        reason: "manual correction",
      },
    });
  });

  it("POST /api/memories/:id/deprecate 应软废弃记忆而不是物理删除", async () => {
    const memory = await store.add({
      type: "preference",
      content: "旧偏好。",
      importance: 0.7,
      metadata: { layer: "L1", confidence: 0.9 },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/memories/${memory.id}/deprecate`,
      payload: { reason: "manual stale memory" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().metadata).toMatchObject({
      status: "deprecated",
      deprecatedReason: "manual stale memory",
    });
    const results = await store.search({ query: "旧偏好", limit: 10 });
    expect(results.map((result) => result.entry.id)).not.toContain(memory.id);
  });

  it("POST /api/memories/merge 应生成合并记忆并把来源标记为 superseded", async () => {
    const a = await store.add({
      type: "preference",
      content: "用户 PPTX 偏好白底。",
      importance: 0.8,
      metadata: { layer: "L1", confidence: 0.9 },
    });
    const b = await store.add({
      type: "preference",
      content: "用户 PPTX 偏好蓝色强调。",
      importance: 0.75,
      metadata: { layer: "L1", confidence: 0.88 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/memories/merge",
      payload: {
        sourceIds: [a.id, b.id],
        content: "用户 PPTX 偏好白底和蓝色强调。",
        type: "preference",
        importance: 0.9,
        namespace: "default",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.target).toMatchObject({
      content: "用户 PPTX 偏好白底和蓝色强调。",
      type: "preference",
      importance: 0.9,
    });
    expect(body.target.metadata.sourceMemoryIds).toEqual([a.id, b.id]);
    expect(body.deprecatedIds).toEqual([a.id, b.id]);
    expect((await store.get(a.id))?.metadata?.status).toBe("superseded");
    expect((await store.get(b.id))?.metadata?.supersededBy).toBe(
      body.target.id,
    );
  });

  it("记忆治理真实闭环：编辑重算 embedding、废弃隐藏、合并隐藏来源并保留 canonical target", async () => {
    const testRun = "memory-governance-scenario-replay";
    const editable = await store.add({
      type: "preference",
      content: `LIVE ${testRun}: 旧内容`,
      importance: 0.7,
      metadata: { testRun, status: "active", tag: "old" },
    });
    const beforeEmbedding = (await store.get(editable.id))?.embedding?.join(
      ",",
    );

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/memories/${editable.id}`,
      payload: {
        content: `LIVE ${testRun}: 新内容，需要重新生成 embedding`,
        importance: 0.91,
        metadata: { tag: "new", reviewer: "scenario-replay" },
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json();
    const afterPatch = await store.get(editable.id);
    expect(patched.content).toContain("新内容");
    expect(patched.importance).toBe(0.91);
    expect(patched.metadata).toMatchObject({
      testRun,
      tag: "new",
      reviewer: "scenario-replay",
    });
    expect(afterPatch?.embedding?.join(",")).toBeTruthy();
    expect(afterPatch?.embedding?.join(",")).not.toBe(beforeEmbedding);

    const deprecated = await store.add({
      type: "preference",
      content: `LIVE ${testRun}: 待废弃记忆`,
      importance: 0.7,
      metadata: { testRun, status: "active" },
    });
    const deprecateRes = await app.inject({
      method: "POST",
      url: `/api/memories/${deprecated.id}/deprecate`,
      payload: { reason: "scenario replay stale memory" },
    });
    expect(deprecateRes.statusCode).toBe(200);
    expect(deprecateRes.json().metadata).toMatchObject({
      status: "deprecated",
      deprecatedReason: "scenario replay stale memory",
    });
    expect(
      (await store.search({ query: testRun, limit: 20 })).map(
        (result) => result.entry.id,
      ),
    ).not.toContain(deprecated.id);

    const sourceA = await store.add({
      type: "preference",
      content: `LIVE ${testRun}: merge source A`,
      importance: 0.7,
      metadata: { testRun, status: "active" },
    });
    const sourceB = await store.add({
      type: "preference",
      content: `LIVE ${testRun}: merge source B`,
      importance: 0.7,
      metadata: { testRun, status: "active" },
    });
    const mergeRes = await app.inject({
      method: "POST",
      url: "/api/memories/merge",
      payload: {
        sourceIds: [sourceA.id, sourceB.id],
        content: `LIVE ${testRun}: merged target`,
        type: "preference",
        importance: 0.93,
      },
    });
    expect(mergeRes.statusCode).toBe(200);
    const merged = mergeRes.json();
    const visibleIds = (await store.search({ query: testRun, limit: 20 })).map(
      (result) => result.entry.id,
    );
    expect(visibleIds).toContain(merged.target.id);
    expect(visibleIds).not.toContain(sourceA.id);
    expect(visibleIds).not.toContain(sourceB.id);
    expect(merged.deprecatedIds).toEqual([sourceA.id, sourceB.id]);
    expect((await store.get(sourceA.id))?.metadata?.status).toBe("superseded");
    expect((await store.get(sourceB.id))?.metadata?.supersededBy).toBe(
      merged.target.id,
    );
  });

  it("记忆质量 API 应暴露有效性统计并可触发自动 janitor", async () => {
    const helpful = await store.add({
      type: "preference",
      content: "PPTX 交付必须发送最终 pptx。",
      importance: 0.9,
      metadata: { layer: "L2", confidence: 0.95 },
    });
    const polluting = await store.add({
      type: "preference",
      content: "用户喜欢川菜。",
      importance: 0.9,
      metadata: { layer: "L3", confidence: 0.95 },
    });
    await store.recordMemoryUsage({
      memoryId: helpful.id,
      source: "active_memory",
      metadata: { outcome: "helpful" },
    });
    await store.recordMemoryUsage({
      memoryId: polluting.id,
      source: "active_memory",
      metadata: { outcome: "polluting" },
    });
    await store.recordMemoryUsage({
      memoryId: polluting.id,
      source: "active_memory",
      metadata: { outcome: "polluting" },
    });

    const statsRes = await app.inject({
      method: "GET",
      url: "/api/memories/effectiveness?namespace=default",
    });
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.json()).toContainEqual(
      expect.objectContaining({
        memoryId: polluting.id,
        totalUses: 2,
        pollutingUses: 2,
        pollutionRate: 1,
      }),
    );

    const janitorRes = await app.inject({
      method: "POST",
      url: "/api/memories/janitor",
      payload: {
        namespace: "default",
        minUses: 2,
        pollutionRateThreshold: 0.5,
      },
    });
    expect(janitorRes.statusCode).toBe(200);
    expect(janitorRes.json()).toMatchObject({
      deprecated: 1,
      deprecatedIds: [polluting.id],
    });
    expect((await store.get(polluting.id))?.metadata?.status).toBe(
      "deprecated",
    );
  });
});

describe("Preview 路由", () => {
  let app: FastifyInstance;
  let dataTmpDir: string;

  beforeEach(async () => {
    dataTmpDir = mkdtempSync(path.join(tmpdir(), "agentclaw-preview-"));
    app = Fastify({ logger: false });
    (registerPreviewRoutes as any)(app, dataTmpDir, {
      markdownPdfRenderer: async ({ html }: { html: string }) =>
        Buffer.from(`PDF:${html.includes("<h1>Report</h1>")}`),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataTmpDir, { recursive: true, force: true });
  });

  it("从 Markdown 预览 HTML 导出 PDF", async () => {
    mkdirSync(path.join(dataTmpDir, "session-1"));
    writeFileSync(
      path.join(dataTmpDir, "session-1", "report.md"),
      "# Report\n\n正文",
      "utf-8",
    );

    const res = await app.inject({
      method: "GET",
      url: "/preview/session-1/report.md.pdf",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain(
      'attachment; filename="report.pdf"',
    );
    expect(res.body).toBe("PDF:true");
  });

  it("不把非 Markdown 的 .pdf 后缀误判为导出", async () => {
    mkdirSync(path.join(dataTmpDir, "session-1"));
    writeFileSync(path.join(dataTmpDir, "session-1", "report.txt"), "text");

    const res = await app.inject({
      method: "GET",
      url: "/preview/session-1/report.txt.pdf",
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("File not found");
  });

  it("不把普通 PDF 预览路径误判为 Markdown 导出", async () => {
    mkdirSync(path.join(dataTmpDir, "session-1"));
    writeFileSync(path.join(dataTmpDir, "session-1", "report.pdf"), "pdf");

    const res = await app.inject({
      method: "GET",
      url: "/preview/session-1/report.pdf",
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Unsupported format: .pdf");
  });
});

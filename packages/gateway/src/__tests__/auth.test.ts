import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "../auth.js";

// 保存原始环境变量
const originalEnv = { ...process.env };

/**
 * 创建一个最小 Fastify 实例，注册 auth hook，并添加测试路由
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // 模拟 /health（在 auth 之前注册，与 server.ts 一致）
  app.get("/health", async () => ({ status: "ok" }));

  // 注册认证
  registerAuth(app);

  // 添加受保护的 API 路由
  app.get("/api/test", async () => ({ ok: true }));
  app.post("/api/test", async () => ({ ok: true }));

  // 添加 WebSocket 路径模拟
  app.get("/ws", async () => ({ ok: true }));

  // 添加静态资源模拟路由
  app.get("/assets/test.js", async () => "console.log('test')");
  app.get("/files/test.png", async () => "image-data");

  // SPA 路由
  app.get("/chat", async () => "chat-page");
  app.get("/settings", async () => "settings-page");

  await app.ready();
  return app;
}

describe("认证中间件 (auth)", () => {
  describe("未设置 API_KEY 时", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      delete process.env.API_KEY;
      // 重新加载模块以获取新的 API_KEY 值
      // 由于 auth.ts 在模块顶层读取 process.env.API_KEY，
      // 我们需要动态重新导入
      vi.resetModules();
      const { registerAuth: freshRegisterAuth } = await import("../auth.js");
      const freshApp = Fastify({ logger: false });
      freshApp.get("/health", async () => ({ status: "ok" }));
      freshRegisterAuth(freshApp);
      freshApp.get("/api/test", async () => ({ ok: true }));
      freshApp.get("/assets/test.js", async () => "js");
      await freshApp.ready();
      app = freshApp;
    });

    afterEach(async () => {
      await app.close();
      process.env = { ...originalEnv };
    });

    it("所有 API 请求无需认证即可通过", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/test",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("静态资源请求正常通过", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/assets/test.js",
      });
      expect(res.statusCode).toBe(200);
    });

    it("/health 端点正常通过", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("设置了 API_KEY 时", () => {
    const TEST_API_KEY = "test-secret-key-12345";
    let app: FastifyInstance;

    beforeEach(async () => {
      process.env.API_KEY = TEST_API_KEY;
      vi.resetModules();
      const { registerAuth: freshRegisterAuth } = await import("../auth.js");
      const freshApp = Fastify({ logger: false });
      freshApp.get("/health", async () => ({ status: "ok" }));
      freshRegisterAuth(freshApp);
      freshApp.get("/api/test", async () => ({ ok: true }));
      freshApp.post("/api/test", async () => ({ created: true }));
      freshApp.get("/ws", async () => ({ ws: true }));
      freshApp.get("/assets/test.js", async () => "js");
      freshApp.get("/files/image.png", async () => "img");
      freshApp.get("/preview/doc.md", async () => "preview");
      freshApp.get("/chat", async () => "chat");
      freshApp.get("/plans", async () => "plans");
      freshApp.get("/memory", async () => "memory");
      freshApp.get("/settings", async () => "settings");
      freshApp.get("/traces", async () => "traces");
      freshApp.get("/token-logs", async () => "token-logs");
      await freshApp.ready();
      app = freshApp;
    });

    afterEach(async () => {
      await app.close();
      process.env = { ...originalEnv };
    });

    it("正确的 Bearer token 可以通过认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: {
          authorization: `Bearer ${TEST_API_KEY}`,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("通过 query 参数 api_key 认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/test?api_key=${TEST_API_KEY}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("通过 query 参数 token 认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/test?token=${TEST_API_KEY}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("错误的 Bearer token 返回 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: {
          authorization: "Bearer wrong-key",
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized" });
    });

    it("无 token 时 API 请求返回 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/test",
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized" });
    });

    it("POST 请求无 token 也返回 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/test",
      });
      expect(res.statusCode).toBe(401);
    });

    it("/ws 路径需要认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/ws",
      });
      expect(res.statusCode).toBe(401);
    });

    it("/ws 路径带正确 token 可通过", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/ws?token=${TEST_API_KEY}`,
      });
      expect(res.statusCode).toBe(200);
    });

    // 静态资源路由不需要认证
    it("/assets/ 路径无需认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/assets/test.js",
      });
      expect(res.statusCode).toBe(200);
    });

    it("/files/ 路径无需认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/files/image.png",
      });
      expect(res.statusCode).toBe(200);
    });

    it("/preview/ 路径无需认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/preview/doc.md",
      });
      expect(res.statusCode).toBe(200);
    });

    it("/health 端点无需认证", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });
      expect(res.statusCode).toBe(200);
    });

    it("/ 根路径无需认证", async () => {
      // 根路径不会被 hook 拦截（SPA 首页）
      // 由于没有注册 / 路由，会返回 404，但不是 401
      const res = await app.inject({
        method: "GET",
        url: "/",
      });
      expect(res.statusCode).not.toBe(401);
    });

    // SPA 前端路由无需认证
    for (const path of ["/chat", "/plans", "/memory", "/settings", "/traces", "/token-logs"]) {
      it(`SPA 路由 ${path} 无需认证`, async () => {
        const res = await app.inject({
          method: "GET",
          url: path,
        });
        expect(res.statusCode).toBe(200);
      });
    }

    it("/api/auth/verify 端点：正确 key 返回 ok", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify",
        headers: {
          authorization: `Bearer ${TEST_API_KEY}`,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("/api/auth/verify 端点：错误 key 返回 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/verify",
        headers: {
          authorization: "Bearer wrong",
        },
      });
      expect(res.statusCode).toBe(401);
      // 全局 onRequest hook 先于路由处理器执行，返回 "Unauthorized"
      expect(res.json().error).toBeDefined();
    });
  });
});

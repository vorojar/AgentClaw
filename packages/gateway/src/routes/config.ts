import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import {
  loadConfig,
  saveConfig,
  maskConfig,
  type AppConfig,
} from "../config.js";
import {
  ClaudeProvider,
  OpenAICompatibleProvider,
  GeminiProvider,
} from "@agentclaw/providers";

export function registerConfigRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  // GET /api/stats - Usage stats
  app.get("/api/stats", async (_req, reply) => {
    try {
      const usage = ctx.memoryStore.getUsageStats();
      const stats = {
        totalInputTokens: usage.totalIn,
        totalOutputTokens: usage.totalOut,
        totalCost: 0,
        totalCalls: usage.totalCalls,
        byModel: usage.byModel.map((m) => ({
          provider: "",
          model: m.model,
          totalInputTokens: m.totalIn,
          totalOutputTokens: m.totalOut,
          totalCost: 0,
          callCount: m.callCount,
        })),
      };
      return reply.send(stats);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // GET /api/config - 返回当前配置（API key 脱敏）
  app.get("/api/config", async (_req, reply) => {
    try {
      const cfg = loadConfig();
      const dailyBriefTime =
        (ctx.memoryStore as any).getSetting?.("daily_brief_time") || "09:00";
      const masked = maskConfig(cfg);
      return reply.send({
        ...masked,
        // 保留旧字段兼容性
        provider: ctx.config.provider,
        model: ctx.config.model,
        databasePath: ctx.config.databasePath,
        skillsDir: ctx.config.skillsDir,
        dailyBriefTime,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // PUT /api/config - 写入 config.json（合并写入）
  app.put<{
    Body: Partial<AppConfig> & { dailyBriefTime?: string };
  }>("/api/config", async (req, reply) => {
    try {
      const updates = req.body;

      // 处理 dailyBriefTime（存到 memory store setting）
      if (updates.dailyBriefTime !== undefined) {
        (ctx.memoryStore as any).setSetting(
          "daily_brief_time",
          updates.dailyBriefTime,
        );
        const restart = (ctx as unknown as Record<string, unknown>)
          .restartDailyBrief as (() => void) | undefined;
        if (restart) restart();
      }

      // 运行时更新 model
      if (updates.defaultModel !== undefined) {
        ctx.config.model = updates.defaultModel;
        (ctx.orchestrator as any).setModel(updates.defaultModel);
      }

      // 兼容旧的 model 字段
      if (
        (updates as any).model !== undefined &&
        updates.defaultModel === undefined
      ) {
        ctx.config.model = (updates as any).model;
        (ctx.orchestrator as any).setModel((updates as any).model);
      }

      // 把配置保存到 config.json（去除 dailyBriefTime，它存在 DB 里）
      const { dailyBriefTime: _dbt, ...configUpdates } = updates;
      if (Object.keys(configUpdates).length > 0) {
        saveConfig(configUpdates as Partial<AppConfig>);
      }

      // 重新加载配置并返回脱敏结果
      const cfg = loadConfig();
      // 更新 appConfig 引用
      (ctx as any).appConfig = cfg;

      const dailyBriefTime =
        (ctx.memoryStore as any).getSetting?.("daily_brief_time") || "09:00";
      const masked = maskConfig(cfg);
      return reply.send({
        ...masked,
        provider: ctx.config.provider,
        model: ctx.config.model,
        databasePath: ctx.config.databasePath,
        skillsDir: ctx.config.skillsDir,
        dailyBriefTime,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/config/validate - 验证 LLM API key 有效性
  app.post<{
    Body: {
      provider: string;
      apiKey: string;
      baseUrl?: string;
      model?: string;
    };
  }>("/api/config/validate", async (req, reply) => {
    try {
      const { provider, apiKey, baseUrl, model } = req.body;
      if (!provider || !apiKey) {
        return reply
          .status(400)
          .send({ valid: false, error: "provider and apiKey are required" });
      }

      let llm;
      try {
        if (provider === "claude" || provider === "anthropic") {
          llm = new ClaudeProvider({
            apiKey,
            defaultModel: model || "claude-sonnet-4-20250514",
          });
        } else if (provider === "gemini") {
          llm = new GeminiProvider({
            apiKey,
            defaultModel: model || "gemini-2.0-flash",
          });
        } else {
          // openai / deepseek / compatible
          llm = new OpenAICompatibleProvider({
            apiKey,
            baseURL: baseUrl,
            defaultModel: model || "gpt-4o-mini",
            providerName: provider,
          });
        }

        // 发送一个极简请求验证 key 有效性
        let _responseText = "";
        for await (const chunk of llm.stream(
          [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          [],
          { maxTokens: 10 },
        )) {
          if (chunk.type === "text") {
            _responseText += chunk.text;
          }
        }

        return reply.send({ valid: true });
      } catch (err) {
        return reply.send({
          valid: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ valid: false, error: message });
    }
  });
}

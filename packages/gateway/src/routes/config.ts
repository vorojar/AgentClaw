import type { FastifyInstance } from "fastify";
import type { AppContext } from "../bootstrap.js";
import type { ChannelManager } from "../channel-manager.js";
import {
  loadConfig,
  saveConfig,
  maskConfig,
  type AppConfig,
  type ProviderInstance,
  type SearchEngineConfig,
} from "../config.js";
import {
  ClaudeProvider,
  OpenAICompatibleProvider,
  GeminiProvider,
} from "@agentclaw/providers";
import { setSearchEngines } from "@agentclaw/tools";
import type { LLMProvider } from "@agentclaw/types";

/** 从 ProviderInstance 创建 LLMProvider */
function createProviderFromInstance(
  inst: ProviderInstance,
  cfg: AppConfig,
): LLMProvider {
  switch (inst.type) {
    case "claude":
      return new ClaudeProvider({
        apiKey: inst.apiKey!,
        defaultModel: inst.model,
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: inst.apiKey!,
        defaultModel: inst.model,
      });
    case "openai":
    default:
      return new OpenAICompatibleProvider({
        apiKey: inst.apiKey!,
        baseURL: inst.baseUrl,
        defaultModel: inst.model,
        providerName: inst.id,
        extraBody: cfg.disableThinking ? { think: false } : undefined,
      });
  }
}

/** Rebuild the active provider from current config */
function rebuildProvider(cfg: AppConfig): {
  provider: LLMProvider;
  name: string;
  model?: string;
} | null {
  const providers = cfg.providers || [];
  const activeId = cfg.activeProvider;

  // 优先找 activeProvider，否则找第一个 enabled 的
  const target =
    providers.find((p) => p.id === activeId && p.apiKey) ||
    providers.find((p) => p.enabled && p.apiKey);
  if (!target) return null;

  return {
    provider: createProviderFromInstance(target, cfg),
    name: target.id,
    model: target.model,
  };
}

const LEGACY_CONFIG_RESPONSE_FIELDS = new Set([
  "anthropicApiKey",
  "openaiApiKey",
  "openaiBaseUrl",
  "geminiApiKey",
  "defaultModel",
  "anthropicModel",
  "openaiModel",
  "geminiModel",
  "searxngUrl",
]);

function buildPublicConfigResponse(
  cfg: AppConfig,
  ctx: AppContext,
  dailyBriefTime: string,
  dailyBriefEnabled: boolean,
): Record<string, unknown> {
  const masked = maskConfig(cfg);
  for (const field of LEGACY_CONFIG_RESPONSE_FIELDS) {
    delete masked[field];
  }

  return {
    ...masked,
    provider: ctx.config.provider,
    model: ctx.config.model,
    databasePath: ctx.config.databasePath,
    skillsDir: ctx.config.skillsDir,
    dailyBriefTime,
    dailyBriefEnabled,
  };
}

export function registerConfigRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  channelManager?: ChannelManager,
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
      const dailyBriefEnabled =
        (ctx.memoryStore as any).getSetting?.("daily_brief_enabled") !==
        "false";
      return reply.send(
        buildPublicConfigResponse(
          cfg,
          ctx,
          dailyBriefTime,
          dailyBriefEnabled,
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // PUT /api/config - 写入 config.json（合并写入）
  app.put<{
    Body: Partial<AppConfig> & {
      model?: string;
      dailyBriefTime?: string;
      dailyBriefEnabled?: boolean;
    };
  }>("/api/config", async (req, reply) => {
    try {
      const updates = req.body;

      // 处理 dailyBriefTime（存到 memory store setting）
      if (updates.dailyBriefTime !== undefined) {
        (ctx.memoryStore as any).setSetting(
          "daily_brief_time",
          updates.dailyBriefTime,
        );
      }

      // 处理 dailyBriefEnabled（存到 memory store setting）
      if (updates.dailyBriefEnabled !== undefined) {
        (ctx.memoryStore as any).setSetting(
          "daily_brief_enabled",
          String(updates.dailyBriefEnabled),
        );
      }

      // 时间或开关变更后重启 cron job
      if (
        updates.dailyBriefTime !== undefined ||
        updates.dailyBriefEnabled !== undefined
      ) {
        const restart = (ctx as unknown as Record<string, unknown>)
          .restartDailyBrief as (() => void) | undefined;
        if (restart) restart();
      }

      // 1. 先保存到 config.json（去除 dailyBrief 相关字段，它们存在 DB 里）
      const {
        dailyBriefTime: _dbt,
        dailyBriefEnabled: _dbe,
        model: requestedModel,
        ...configUpdates
      } = updates;

      // 保护脱敏 apiKey：如果前端提交的 apiKey 是 "****" 格式，用 config.json 中的原值替换
      if (configUpdates.providers && Array.isArray(configUpdates.providers)) {
        const existingCfg = loadConfig();
        const existingProviders = existingCfg.providers || [];
        configUpdates.providers = (
          configUpdates.providers as ProviderInstance[]
        ).map((p) => {
          if (p.apiKey && p.apiKey.startsWith("****")) {
            const existing = existingProviders.find((ep) => ep.id === p.id);
            return { ...p, apiKey: existing?.apiKey || "" };
          }
          return p;
        });
      }

      // 保护脱敏搜索引擎 apiKey
      if (
        configUpdates.searchEngines &&
        Array.isArray(configUpdates.searchEngines)
      ) {
        const existingCfg = loadConfig();
        const existingEngines = existingCfg.searchEngines || [];
        configUpdates.searchEngines = (
          configUpdates.searchEngines as SearchEngineConfig[]
        ).map((s) => {
          if (s.apiKey && s.apiKey.startsWith("****")) {
            const existing = existingEngines.find((es) => es.id === s.id);
            return { ...s, apiKey: existing?.apiKey || "" };
          }
          return s;
        });
      }

      if (Object.keys(configUpdates).length > 0) {
        saveConfig(configUpdates as Partial<AppConfig>);
      }

      // 2. 重新加载完整配置
      const cfg = loadConfig();
      (ctx as any).appConfig = cfg;

      // 3. 判断是否需要热重建 provider
      const providerFields = ["providers", "activeProvider", "disableThinking"];
      if (providerFields.some((f) => f in configUpdates)) {
        const newProvider = rebuildProvider(cfg);
        if (newProvider) {
          ctx.config.provider = newProvider.name;
          ctx.config.model = newProvider.model;
          (ctx.orchestrator as any).setProvider(newProvider.provider);
          if (newProvider.model) {
            (ctx.orchestrator as any).setModel(newProvider.model);
          }
          (ctx as any).provider = newProvider.provider;
        }
      }
      if (requestedModel !== undefined) {
        ctx.config.model = requestedModel;
        (ctx.orchestrator as any).setModel(requestedModel);
      }

      // 4. 渠道配置变更时热重启渠道
      const channelFields = [
        "telegram",
        "dingtalk",
        "feishu",
        "qqBot",
        "wecom",
        "whatsapp",
        "email",
      ];
      if (channelManager && channelFields.some((f) => f in configUpdates)) {
        await channelManager.refreshConfig();
      }

      // 5. 搜索引擎配置变更时热刷新 web_search 工具 + 健康检查
      if ("searchEngines" in configUpdates && cfg.searchEngines) {
        setSearchEngines(cfg.searchEngines);
        // 刷新健康检查
        const refreshHealth = (ctx as unknown as Record<string, unknown>)
          .refreshHealth as (() => Promise<unknown>) | undefined;
        if (refreshHealth) refreshHealth();
      }

      const dailyBriefTime =
        (ctx.memoryStore as any).getSetting?.("daily_brief_time") || "09:00";
      const dailyBriefEnabled =
        (ctx.memoryStore as any).getSetting?.("daily_brief_enabled") !==
        "false";
      return reply.send(
        buildPublicConfigResponse(
          cfg,
          ctx,
          dailyBriefTime,
          dailyBriefEnabled,
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/config/test-search - Test a search engine connection
  app.post<{
    Body: { type: string; url?: string; apiKey?: string };
  }>("/api/config/test-search", async (req, reply) => {
    const { type, url, apiKey: frontendKey } = req.body;
    // Use real API key from config if frontend sent a masked value
    let apiKey = frontendKey;
    if (!apiKey || apiKey.startsWith("****")) {
      const cfg = loadConfig();
      const engine = cfg.searchEngines?.find(
        (e) => e.type === type && (e.url === url || type === "serper"),
      );
      apiKey = engine?.apiKey || "";
    }
    const timeout = 10000;
    try {
      let testUrl: string;
      let options: RequestInit = {};

      if (type === "serper") {
        testUrl = "https://google.serper.dev/search";
        options = {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey || "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: "test", num: 1 }),
          signal: AbortSignal.timeout(timeout),
        };
      } else if (type === "querit") {
        testUrl = url || "https://api.querit.ai/v1/search";
        options = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: "test", count: 1 }),
          signal: AbortSignal.timeout(timeout),
        };
      } else {
        // searxng / custom — GET request
        const base = (url || "").replace(/\/+$/, "");
        testUrl = `${base}/search?q=test&format=json&language=en&pageno=1`;
        options = { signal: AbortSignal.timeout(timeout) };
      }

      const response = await fetch(testUrl, options);
      if (!response.ok) {
        return reply.send({
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        });
      }
      return reply.send({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.send({ success: false, error: message });
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
        for await (const chunk of llm.stream({
          messages: [
            {
              id: "config-test",
              role: "user",
              content: [{ type: "text", text: "Hi" }],
              createdAt: new Date(),
            },
          ],
          maxTokens: 10,
        })) {
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

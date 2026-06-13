import { SimpleOrchestrator, SkillRegistryImpl } from "@agentclaw/core";
import {
  ClaudeProvider,
  OpenAICompatibleProvider,
  GeminiProvider,
  FailoverProvider,
  VolcanoEmbedding,
} from "@agentclaw/providers";
import {
  ToolRegistryImpl,
  createBuiltinTools,
  shellInfo,
  MCPManager,
  setSearchEngines,
} from "@agentclaw/tools";
import { initDatabase, SQLiteMemoryStore } from "@agentclaw/memory";
import type { LLMProvider, Orchestrator, AgentProfile } from "@agentclaw/types";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { platform, arch, homedir } from "node:os";
import { TaskScheduler } from "./scheduler.js";
import {
  runHealthChecks,
  formatHealthResults,
  type HealthCheckResult,
} from "./health-check.js";
import { loadConfig, type AppConfig, type ProviderInstance } from "./config.js";
import { broadcastSessionActivity } from "./utils.js";

export interface AppContext {
  provider: LLMProvider;
  visionProvider?: LLMProvider;
  orchestrator: Orchestrator;
  toolRegistry: ToolRegistryImpl;
  memoryStore: SQLiteMemoryStore;
  skillRegistry: SkillRegistryImpl;
  config: AppRuntimeConfig;
  /** 完整的应用配置（来自 config.json + 环境变量） */
  appConfig: AppConfig;
  scheduler: TaskScheduler;
  agents: AgentProfile[];
  /** Reload agents from DB and update orchestrator */
  refreshAgents: () => void;
  /**
   * 重新运行健康检查并更新系统提示词。
   * 返回变化的检查项（从 ok→fail 或 fail→ok），便于外部决定是否通知。
   */
  refreshHealth: () => Promise<HealthCheckResult[]>;
  /** MCP server manager for dynamic add/remove/reload */
  mcpManager: MCPManager;
}

export interface AppRuntimeConfig {
  provider: string;
  model?: string;
  visionProvider?: string;
  visionModel?: string;
  fastProvider?: string;
  fastModel?: string;
  databasePath: string;
  skillsDir: string;
}

const RUNTIME_SYSTEM_PROMPT_VARS = new Set([
  "soul",
  "platformHint",
  "datetime",
  "timezone",
]);

export function renderSystemPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let prompt = template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    RUNTIME_SYSTEM_PROMPT_VARS.has(key) ? match : (vars[key] ?? ""),
  );
  prompt = prompt.replace(
    /\{\{#if (\w+)\}\}(.*?)\{\{\/if\}\}/gs,
    (match, key, content) =>
      RUNTIME_SYSTEM_PROMPT_VARS.has(key) ? match : vars[key] ? content : "",
  );
  return prompt;
}

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

function collectProviders(cfg: AppConfig): {
  provider: LLMProvider;
  providerName: string;
  model?: string;
} {
  const instances = (cfg.providers || []).filter((p) => p.apiKey);

  // Fallback: local Ollama when no provider is configured
  if (instances.length === 0) {
    const baseURL =
      cfg.ollamaBaseUrl ||
      process.env.LLM_BASE_URL ||
      "http://localhost:11434/v1";
    const model = cfg.ollamaModel || cfg.defaultModel || "llama3";
    const localProvider = new OpenAICompatibleProvider({
      apiKey: "ollama",
      baseURL,
      defaultModel: model,
      providerName: "local",
      extraBody: cfg.disableThinking ? { think: false } : undefined,
    });
    return { provider: localProvider, providerName: "local", model };
  }

  // Sort: enabled + activeProvider first, then enabled, then disabled
  const active = cfg.activeProvider;
  const sorted = [...instances].sort((a, b) => {
    if (a.id === active && a.enabled) return -1;
    if (b.id === active && b.enabled) return 1;
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return 0;
  });

  // Only create providers for instances with API keys
  const enabledInstances = sorted.filter((p) => p.enabled);
  const candidates =
    enabledInstances.length > 0 ? enabledInstances : [sorted[0]];

  const providers = candidates.map((inst) =>
    createProviderFromInstance(inst, cfg),
  );
  const provider =
    providers.length > 1 ? new FailoverProvider(providers) : providers[0];

  if (providers.length > 1) {
    console.log(
      `[bootstrap] Failover chain: ${candidates.map((c) => c.id).join(" → ")}`,
    );
  }

  const primary = candidates[0];
  return { provider, providerName: primary.id, model: primary.model };
}

/**
 * Create an optional provider from config fields.
 * Used for vision and fast providers which share the same configuration pattern.
 * Returns null if the API key is not set.
 */
function createOptionalProvider(
  apiKey: string | undefined,
  providerType: string | undefined,
  model: string | undefined,
  baseURL: string | undefined,
  label: string,
  fallbackName: string,
): { provider: LLMProvider; type: string; model?: string } | null {
  if (!apiKey) return null;

  const type = providerType || "openai";

  let provider: LLMProvider;
  if (type === "claude") {
    provider = new ClaudeProvider({ apiKey, defaultModel: model });
  } else if (type === "gemini") {
    provider = new GeminiProvider({ apiKey, defaultModel: model });
  } else {
    provider = new OpenAICompatibleProvider({
      apiKey,
      baseURL,
      defaultModel: model,
      providerName: fallbackName,
    });
  }

  console.log(
    `[bootstrap] ${label} provider: ${type}, model: ${model ?? "default"}`,
  );
  return { provider, type, model };
}

export async function bootstrap(): Promise<AppContext> {
  // 加载统一配置（config.json + 环境变量 + 默认值）
  const cfg = loadConfig();

  // Database setup
  const databasePath = cfg.dbPath;
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = initDatabase(databasePath);

  // Provider (with automatic failover when multiple API keys are configured)
  const { provider, providerName, model } = collectProviders(cfg);

  // Vision provider (optional, for multimodal image support)
  const visionResult = createOptionalProvider(
    cfg.visionApiKey,
    cfg.visionProvider,
    cfg.visionModel,
    undefined,
    "Vision",
    "vision",
  );
  const visionProvider = visionResult?.provider;
  const visionProviderName = visionResult?.type;
  const visionModelName = visionResult?.model;
  if (!visionResult) {
    console.log(
      "[bootstrap] No VISION_API_KEY set — vision routing disabled. Images will be sent as text descriptions.",
    );
  }

  // Fast provider (optional, for simple chat routing)
  const fastResult = createOptionalProvider(
    cfg.fastApiKey,
    cfg.fastProvider,
    cfg.fastModel,
    undefined,
    "Fast",
    "fast",
  );
  const fastProvider = fastResult?.provider;
  const fastProviderName = fastResult?.type;
  const fastModelName = fastResult?.model;

  // Tool registry
  const toolRegistry = new ToolRegistryImpl();
  const builtinTools = createBuiltinTools({
    gateway: true, // gateway 模式，启用 send_file/schedule
    browserCdp: process.env.AGENTCLAW_ENABLE_BROWSER_CDP === "true", // 浏览器自动化需要显式安装 Chrome/Chromium 后启用
    memory: true, // 启用 remember
    skills: true, // 启用 use_skill
    claudeCode: true, // 启用 claude_code（Claude Code CLI）
    observationRead: true, // 启用 Observation Store 定向读取
    rss: true, // Reddit/RSS 日报任务需要 rss_top，但不属于默认核心工具
  });
  for (const tool of builtinTools) {
    toolRegistry.register(tool);
  }

  // Inject search engine config into web_search tool
  if (cfg.searchEngines) {
    setSearchEngines(cfg.searchEngines);
  }

  // MCP servers (optional)
  const mcpManager = new MCPManager();
  const mcpConfigPath = resolve(process.cwd(), "data", "mcp-servers.json");
  if (existsSync(mcpConfigPath)) {
    try {
      const mcpConfigs = JSON.parse(
        readFileSync(mcpConfigPath, "utf-8"),
      ) as Array<{
        name: string;
        transport: "stdio" | "http";
        command?: string;
        args?: string[];
        url?: string;
        env?: Record<string, string>;
      }>;
      for (const config of mcpConfigs) {
        try {
          const tools = await mcpManager.addServer(config);
          for (const tool of tools) {
            toolRegistry.register(tool);
          }
          console.log(
            `[bootstrap] MCP server "${config.name}" connected: ${tools.length} tools`,
          );
        } catch (err) {
          console.error(
            `[bootstrap] MCP server "${config.name}" failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } catch (err) {
      console.error(
        "[bootstrap] Failed to load MCP config:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Memory store
  const memoryStore = new SQLiteMemoryStore(db);

  // Embedding: prefer dedicated Volcano Engine API, fallback to LLM provider
  const volcanoEmbedKey = cfg.volcanoEmbeddingKey;
  if (volcanoEmbedKey) {
    const embedding = new VolcanoEmbedding({
      apiKey: volcanoEmbedKey,
      model: process.env.VOLCANO_EMBEDDING_MODEL,
    });
    memoryStore.setEmbedFn((texts) => embedding.embed(texts));
    console.log("[bootstrap] Embedding: Volcano Engine (doubao)");
  } else if (provider.embed) {
    memoryStore.setEmbedFn((texts) => provider.embed!(texts));
  }

  // Detect runtime environment
  const os = platform();
  const osName =
    os === "win32" ? "Windows" : os === "darwin" ? "macOS" : "Linux";
  const tempDir = resolve(process.cwd(), "data", "tmp");
  mkdirSync(tempDir, { recursive: true });

  // Detect available CLI tools
  const cliTools = [
    "ffmpeg",
    "ffprobe",
    "git",
    "curl",
    "wget",
    "magick",
    "node",
    "npm",
    "claude",
  ];
  const availableCli: string[] = [];
  for (const tool of cliTools) {
    try {
      execFileSync(os === "win32" ? "where" : "which", [tool], {
        timeout: 2000,
        stdio: "ignore",
        windowsHide: true,
      });
      availableCli.push(tool);
    } catch {
      // not available
    }
  }

  let shellDesc: string;
  if (shellInfo.name !== "bash") {
    shellDesc = "PowerShell，使用 PowerShell 语法";
  } else if (process.platform === "win32") {
    shellDesc =
      'bash (Git Bash)，使用 Unix 命令。Windows 专属任务（注册表、WMI）用 shell="powershell"';
  } else {
    shellDesc = "bash，使用 Unix 命令";
  }

  console.log(
    `[bootstrap] Shell: ${shellInfo.name} (${shellInfo.shell}), CLI tools: ${availableCli.join(", ") || "none detected"}`,
  );

  // Load system prompt from external file, with runtime variable substitution
  const systemPromptPath = resolve(process.cwd(), cfg.systemPromptFile);
  let defaultSystemPrompt: string;

  // 启动时运行健康检查，将结果注入系统提示词
  let healthResults: HealthCheckResult[] = [];
  try {
    healthResults = await runHealthChecks(cfg.searchEngines);
    const failCount = healthResults.filter((r) => !r.ok).length;
    console.log(
      `[bootstrap] Health check: ${healthResults.length - failCount} ok, ${failCount} failed (${healthResults.length} total)`,
    );
  } catch (err) {
    console.error(
      "[bootstrap] Health check error:",
      err instanceof Error ? err.message : err,
    );
  }

  // Load SOUL.md personality file (used as default agent soul)
  const soulPath = resolve(process.cwd(), "data", "SOUL.md");
  let _soul = "You are AgentClaw, a powerful AI assistant.";
  if (existsSync(soulPath)) {
    _soul = readFileSync(soulPath, "utf-8").trim();
    console.log(`[bootstrap] Soul loaded from ${soulPath}`);
  }

  if (existsSync(systemPromptPath)) {
    const template = readFileSync(systemPromptPath, "utf-8");
    const vars: Record<string, string> = {
      os: osName,
      arch: arch(),
      shell: shellDesc,
      homedir: homedir().replace(/\\/g, "/"),
      tempdir: tempDir.replace(/\\/g, "/"),
      availableCli: availableCli.join(", "),
      isWindows: os === "win32" ? "true" : "",
      hasClaudeCode: availableCli.includes("claude") ? "true" : "",
      health: formatHealthResults(healthResults),
    };
    defaultSystemPrompt = renderSystemPromptTemplate(template, vars);
    console.log(`[bootstrap] System prompt loaded from ${systemPromptPath}`);
  } else {
    defaultSystemPrompt = `You are AgentClaw, a powerful AI assistant. Reply concisely.`;
    console.warn(
      `[bootstrap] System prompt file not found at ${systemPromptPath}, using minimal fallback`,
    );
  }

  // Scheduler
  const scheduler = new TaskScheduler(memoryStore);

  // Skill registry
  const skillsDir = cfg.skillsDir;
  const skillRegistry = new SkillRegistryImpl();
  skillRegistry.setSettingsPath(
    resolve(process.cwd(), "data", "skill-settings.json"),
  );
  await skillRegistry.loadFromDirectory(skillsDir);

  // Load agents from filesystem (data/agents/)
  const { loadAgentsFromFs } = await import("./routes/agents.js");
  let agents = loadAgentsFromFs();
  console.log(
    `[bootstrap] Agents loaded: ${agents.map((a) => a.id).join(", ")}`,
  );

  // Orchestrator
  const maxIterations = cfg.maxIterations;

  const orchestrator = new SimpleOrchestrator({
    provider,
    visionProvider,
    fastProvider,
    toolRegistry,
    memoryStore,
    systemPrompt: defaultSystemPrompt,
    scheduler,
    skillRegistry,
    skillsDir,
    tmpDir: tempDir,
    agents,
    disabledTools: cfg.disabledTools,
    onSessionUpdated: (session) => {
      broadcastSessionActivity(session.id, "web");
    },
    ...(maxIterations ? { agentConfig: { maxIterations } } : {}),
  });

  // Config-driven tool permissions
  if (cfg.toolPermissions) {
    const perms = cfg.toolPermissions;
    orchestrator.getHookManager().addGlobalHook({
      before: async (call) => {
        const perm = perms[call.name];
        if (!perm) return call;
        if (perm.mode === "deny") return null;
        if (perm.blockedPatterns?.length) {
          const inputStr = JSON.stringify(call.input);
          if (perm.blockedPatterns.some((p) => inputStr.includes(p)))
            return null;
        }
        return call;
      },
    });
  }

  const config: AppRuntimeConfig = {
    provider: providerName,
    model,
    visionProvider: visionProviderName,
    visionModel: visionModelName,
    fastProvider: fastProviderName,
    fastModel: fastModelName,
    databasePath,
    skillsDir,
  };

  // 保存上次健康状态，用于检测变化
  let lastHealthMap = new Map(healthResults.map((r) => [r.name, r.ok]));

  // 构建基准系统提示词（不含 health 部分），用于后续刷新
  const baseSystemPrompt = defaultSystemPrompt.replace(
    /\[注意\] 以下服务当前不可用：.*?。涉及这些服务的请求请告知用户。\n?/,
    "",
  );

  /**
   * 重新运行健康检查，更新系统提示词。
   * 返回状态发生变化的检查项。
   */
  const refreshHealth = async (): Promise<HealthCheckResult[]> => {
    const latestConfig = loadConfig();
    const results = await runHealthChecks(latestConfig.searchEngines);
    const healthText = formatHealthResults(results);

    // 用基准提示词 + 新的 health 文本重建系统提示词
    const newPrompt = healthText
      ? baseSystemPrompt.replace(/^(.*?\n)(## 规则)/ms, `$1${healthText}$2`)
      : baseSystemPrompt;

    orchestrator.updateSystemPrompt(newPrompt);

    // 只广播新增故障（ok→fail），恢复（fail→ok）静默更新提示词即可
    const changed = results.filter(
      (r) => !r.ok && lastHealthMap.get(r.name) === true,
    );

    // 更新缓存
    lastHealthMap = new Map(results.map((r) => [r.name, r.ok]));

    return changed;
  };

  const refreshAgents = () => {
    agents = loadAgentsFromFs();
    orchestrator.updateAgents(agents);
  };

  return {
    provider,
    visionProvider,
    orchestrator,
    toolRegistry,
    memoryStore,
    skillRegistry,
    config,
    appConfig: cfg,
    scheduler,
    agents,
    refreshAgents,
    refreshHealth,
    mcpManager,
  };
}

import { SimpleOrchestrator, SkillRegistryImpl } from "@agentclaw/core";
import {
  ClaudeProvider,
  OpenAICompatibleProvider,
  GeminiProvider,
  FailoverProvider,
  VolcanoEmbedding,
  generateId,
} from "@agentclaw/providers";
import {
  ToolRegistryImpl,
  createBuiltinTools,
  shellInfo,
  MCPManager,
} from "@agentclaw/tools";
import { initDatabase, SQLiteMemoryStore } from "@agentclaw/memory";
import type {
  LLMProvider,
  Orchestrator,
  SkillRegistry,
  ToolRegistry,
  MemoryStore,
  AgentProfile,
} from "@agentclaw/types";
import { mkdirSync, readFileSync, existsSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, resolve } from "path";
import { platform, arch, homedir, tmpdir } from "os";
import { TaskScheduler } from "./scheduler.js";
import {
  runHealthChecks,
  formatHealthResults,
  type HealthCheckResult,
} from "./health-check.js";

export interface AppContext {
  provider: LLMProvider;
  visionProvider?: LLMProvider;
  orchestrator: Orchestrator;
  toolRegistry: ToolRegistryImpl;
  memoryStore: SQLiteMemoryStore;
  skillRegistry: SkillRegistryImpl;
  config: AppRuntimeConfig;
  scheduler: TaskScheduler;
  agents: AgentProfile[];
  /** Reload agents from DB and update orchestrator */
  refreshAgents: () => void;
  /**
   * 重新运行健康检查并更新系统提示词。
   * 返回变化的检查项（从 ok→fail 或 fail→ok），便于外部决定是否通知。
   */
  refreshHealth: () => Promise<HealthCheckResult[]>;
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

/**
 * Collect all configured providers in priority order.
 * The first provider uses DEFAULT_MODEL; backup providers use their own defaults.
 */
function collectProviders(): {
  provider: LLMProvider;
  providerName: string;
  model?: string;
} {
  const defaultModel = process.env.DEFAULT_MODEL;

  // Provider candidates in priority order: first configured wins the default model
  const candidates: Array<{
    name: string;
    create: (isFirst: boolean) => LLMProvider;
  }> = [];

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    candidates.push({
      name: "claude",
      create: (isFirst) =>
        new ClaudeProvider({
          apiKey: anthropicKey,
          defaultModel: isFirst ? defaultModel : undefined,
        }),
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const baseURL = process.env.OPENAI_BASE_URL;
    candidates.push({
      name: "openai",
      create: (isFirst) =>
        new OpenAICompatibleProvider({
          apiKey: openaiKey,
          baseURL,
          defaultModel: isFirst ? defaultModel : undefined,
          providerName: "openai",
        }),
    });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    candidates.push({
      name: "gemini",
      create: (isFirst) =>
        new GeminiProvider({
          apiKey: geminiKey,
          defaultModel: isFirst ? defaultModel : undefined,
        }),
    });
  }

  // Fallback: local Ollama when no cloud key is set
  if (candidates.length === 0) {
    const baseURL =
      process.env.OLLAMA_BASE_URL ||
      process.env.LLM_BASE_URL ||
      "http://localhost:11434/v1";
    const model = process.env.OLLAMA_MODEL || defaultModel || "llama3";
    const localProvider = new OpenAICompatibleProvider({
      apiKey: "ollama",
      baseURL,
      defaultModel: model,
      providerName: "local",
    });
    return { provider: localProvider, providerName: "local", model };
  }

  const providers = candidates.map((c, i) => c.create(i === 0));
  const provider =
    providers.length > 1 ? new FailoverProvider(providers) : providers[0];

  if (providers.length > 1) {
    console.log(
      `[bootstrap] Failover chain: ${providers.map((p) => p.name).join(" → ")}`,
    );
  }

  return { provider, providerName: candidates[0].name, model: defaultModel };
}

/**
 * Create an optional provider from environment variables.
 * Used for vision and fast providers which share the same configuration pattern.
 * Returns null if the API key env var is not set.
 */
function createOptionalProvider(
  envPrefix: string,
  fallbackName: string,
): { provider: LLMProvider; type: string; model?: string } | null {
  const apiKey = process.env[`${envPrefix}_API_KEY`];
  if (!apiKey) return null;

  const baseURL = process.env[`${envPrefix}_BASE_URL`];
  const model = process.env[`${envPrefix}_MODEL`];
  const type = process.env[`${envPrefix}_PROVIDER`] || "openai";

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
    `[bootstrap] ${envPrefix.charAt(0) + envPrefix.slice(1).toLowerCase()} provider: ${type}, model: ${model ?? "default"}`,
  );
  return { provider, type, model };
}

/**
 * Seed agents from data/agents/ directory into DB (one-time migration).
 * Then always read from DB.
 */
function seedAgentsFromFilesystem(
  memoryStore: SQLiteMemoryStore,
  defaultSoul: string,
): void {
  // Only seed if DB has no agents yet
  const existing = memoryStore.listAgents();
  if (existing.length > 0) return;

  const agentsDir = resolve(process.cwd(), "data", "agents");
  let order = 0;

  // Seed "default" first
  memoryStore.saveAgent({
    id: "default",
    name: "AgentClaw",
    description: "Default assistant",
    avatar: "",
    soul: defaultSoul,
    sortOrder: order++,
  });

  if (existsSync(agentsDir)) {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(agentsDir, entry.name);
      const soulPath = resolve(dir, "SOUL.md");
      const configPath = resolve(dir, "config.json");

      const soul = existsSync(soulPath)
        ? readFileSync(soulPath, "utf-8").trim()
        : defaultSoul;

      let config: Partial<AgentProfile> = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch {
          console.warn(
            `[bootstrap] Invalid config.json in agents/${entry.name}`,
          );
        }
      }

      memoryStore.saveAgent({
        id: entry.name,
        name: config.name ?? entry.name,
        description: config.description ?? "",
        avatar: config.avatar ?? "",
        soul,
        model: config.model || undefined,
        tools: config.tools ?? undefined,
        maxIterations: config.maxIterations,
        temperature: config.temperature,
        sortOrder: order++,
      });
    }
  }

  console.log("[bootstrap] Seeded agents from filesystem to DB");
}

export async function bootstrap(): Promise<AppContext> {
  // Database setup
  const databasePath = process.env.DB_PATH || "./data/agentclaw.db";
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = initDatabase(databasePath);

  // Provider (with automatic failover when multiple API keys are configured)
  const { provider, providerName, model } = collectProviders();

  // Vision provider (optional, for multimodal image support)
  const visionResult = createOptionalProvider("VISION", "vision");
  const visionProvider = visionResult?.provider;
  const visionProviderName = visionResult?.type;
  const visionModelName = visionResult?.model;
  if (!visionResult) {
    console.log(
      "[bootstrap] No VISION_API_KEY set — vision routing disabled. Images will be sent as text descriptions.",
    );
  }

  // Fast provider (optional, for simple chat routing)
  const fastResult = createOptionalProvider("FAST", "fast");
  const fastProvider = fastResult?.provider;
  const fastProviderName = fastResult?.type;
  const fastModelName = fastResult?.model;

  // Tool registry
  const toolRegistry = new ToolRegistryImpl();
  const builtinTools = createBuiltinTools({
    gateway: true, // gateway 模式，启用 send_file/schedule
    memory: true, // 启用 remember
    skills: true, // 启用 use_skill
    claudeCode: true, // 启用 claude_code（Claude Code CLI）
  });
  for (const tool of builtinTools) {
    toolRegistry.register(tool);
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
  const volcanoEmbedKey = process.env.VOLCANO_EMBEDDING_KEY;
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
    "deno",
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
  const systemPromptPath = resolve(
    process.cwd(),
    process.env.SYSTEM_PROMPT_FILE || "system-prompt.md",
  );
  let defaultSystemPrompt: string;

  // 启动时运行健康检查，将结果注入系统提示词
  let healthResults: HealthCheckResult[] = [];
  try {
    healthResults = await runHealthChecks();
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
  let soul = "You are AgentClaw, a powerful AI assistant.";
  if (existsSync(soulPath)) {
    soul = readFileSync(soulPath, "utf-8").trim();
    console.log(`[bootstrap] Soul loaded from ${soulPath}`);
  }

  if (existsSync(systemPromptPath)) {
    const template = readFileSync(systemPromptPath, "utf-8");
    const datetime = new Date().toLocaleString("zh-CN", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false,
    });

    const vars: Record<string, string> = {
      datetime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    // Replace {{var}} placeholders (keep {{soul}} for per-agent resolution)
    defaultSystemPrompt = template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
      key === "soul" ? match : (vars[key] ?? ""),
    );
    // Handle {{#if var}}...{{/if}} conditionals
    defaultSystemPrompt = defaultSystemPrompt.replace(
      /\{\{#if (\w+)\}\}(.*?)\{\{\/if\}\}/gs,
      (_, key, content) => (vars[key] ? content : ""),
    );
    console.log(`[bootstrap] System prompt loaded from ${systemPromptPath}`);
  } else {
    defaultSystemPrompt = `You are AgentClaw, a powerful AI assistant. Reply concisely.`;
    console.warn(
      `[bootstrap] System prompt file not found at ${systemPromptPath}, using minimal fallback`,
    );
  }

  // Scheduler
  const scheduler = new TaskScheduler();

  // Skill registry
  const skillsDir = process.env.SKILLS_DIR || "./skills/";
  const skillRegistry = new SkillRegistryImpl();
  skillRegistry.setSettingsPath(
    resolve(process.cwd(), "data", "skill-settings.json"),
  );
  await skillRegistry.loadFromDirectory(skillsDir);

  // Seed agents from filesystem (one-time), then load from DB
  seedAgentsFromFilesystem(memoryStore, soul);
  let agents = memoryStore.listAgents();
  console.log(
    `[bootstrap] Agents loaded: ${agents.map((a) => a.id).join(", ")}`,
  );

  // Orchestrator
  const orchestrator = new SimpleOrchestrator({
    provider,
    visionProvider,
    fastProvider,
    toolRegistry,
    memoryStore,
    systemPrompt: defaultSystemPrompt,
    scheduler,
    skillRegistry,
    tmpDir: tempDir,
    agents,
  });

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
    const results = await runHealthChecks();
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
    agents = memoryStore.listAgents();
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
    scheduler,
    agents,
    refreshAgents,
    refreshHealth,
  };
}

import {
  SimpleOrchestrator,
  SimplePlanner,
  SimpleAgentLoop,
  SimpleContextManager,
  SkillRegistryImpl,
} from "@agentclaw/core";
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
  Planner,
  SkillRegistry,
  ToolRegistry,
  MemoryStore,
} from "@agentclaw/types";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, resolve } from "path";
import { platform, arch, homedir, tmpdir } from "os";
import { TaskScheduler } from "./scheduler.js";

export interface AppContext {
  provider: LLMProvider;
  visionProvider?: LLMProvider;
  orchestrator: Orchestrator;
  planner: Planner;
  toolRegistry: ToolRegistryImpl;
  memoryStore: SQLiteMemoryStore;
  skillRegistry: SkillRegistryImpl;
  config: AppRuntimeConfig;
  scheduler: TaskScheduler;
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
  const providers: LLMProvider[] = [];
  const defaultModel = process.env.DEFAULT_MODEL;
  let primaryName = "local";
  let primaryModel: string | undefined;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const isFirst = providers.length === 0;
    providers.push(
      new ClaudeProvider({
        apiKey: anthropicKey,
        defaultModel: isFirst ? defaultModel : undefined,
      }),
    );
    if (isFirst) {
      primaryName = "claude";
      primaryModel = defaultModel;
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const isFirst = providers.length === 0;
    const baseURL = process.env.OPENAI_BASE_URL;
    providers.push(
      new OpenAICompatibleProvider({
        apiKey: openaiKey,
        baseURL,
        defaultModel: isFirst ? defaultModel : undefined,
        providerName: "openai",
      }),
    );
    if (isFirst) {
      primaryName = "openai";
      primaryModel = defaultModel;
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const isFirst = providers.length === 0;
    providers.push(
      new GeminiProvider({
        apiKey: geminiKey,
        defaultModel: isFirst ? defaultModel : undefined,
      }),
    );
    if (isFirst) {
      primaryName = "gemini";
      primaryModel = defaultModel;
    }
  }

  // Fallback: local Ollama when no cloud key is set
  if (providers.length === 0) {
    const baseURL =
      process.env.OLLAMA_BASE_URL ||
      process.env.LLM_BASE_URL ||
      "http://localhost:11434/v1";
    const model = process.env.OLLAMA_MODEL || defaultModel || "llama3";
    providers.push(
      new OpenAICompatibleProvider({
        apiKey: "ollama",
        baseURL,
        defaultModel: model,
        providerName: "local",
      }),
    );
    primaryModel = model;
  }

  const provider =
    providers.length > 1 ? new FailoverProvider(providers) : providers[0];

  if (providers.length > 1) {
    console.log(
      `[bootstrap] Failover chain: ${providers.map((p) => p.name).join(" → ")}`,
    );
  }

  return { provider, providerName: primaryName, model: primaryModel };
}

export async function bootstrap(): Promise<AppContext> {
  // Database setup
  const databasePath = process.env.DB_PATH || "./data/agentclaw.db";
  try {
    mkdirSync(dirname(databasePath), { recursive: true });
  } catch {
    // directory may already exist
  }
  const db = initDatabase(databasePath);

  // Provider (with automatic failover when multiple API keys are configured)
  const { provider, providerName, model } = collectProviders();

  // Vision provider (optional, for multimodal image support)
  let visionProvider: LLMProvider | undefined;
  let visionProviderName: string | undefined;
  let visionModelName: string | undefined;
  const visionApiKey = process.env.VISION_API_KEY;
  if (visionApiKey) {
    const visionBaseURL = process.env.VISION_BASE_URL;
    const visionModel = process.env.VISION_MODEL;
    const visionProviderType = process.env.VISION_PROVIDER || "openai";

    if (visionProviderType === "claude") {
      visionProvider = new ClaudeProvider({
        apiKey: visionApiKey,
        defaultModel: visionModel,
      });
    } else if (visionProviderType === "gemini") {
      visionProvider = new GeminiProvider({
        apiKey: visionApiKey,
        defaultModel: visionModel,
      });
    } else {
      visionProvider = new OpenAICompatibleProvider({
        apiKey: visionApiKey,
        baseURL: visionBaseURL,
        defaultModel: visionModel,
        providerName: "vision",
      });
    }

    visionProviderName = visionProviderType;
    visionModelName = visionModel;
    console.log(
      `[bootstrap] Vision provider: ${visionProviderType}, model: ${visionModel ?? "default"}`,
    );
  } else {
    console.log(
      "[bootstrap] No VISION_API_KEY set — vision routing disabled. Images will be sent as text descriptions.",
    );
  }

  // Fast provider (optional, for simple chat routing)
  let fastProvider: LLMProvider | undefined;
  let fastProviderName: string | undefined;
  let fastModelName: string | undefined;
  const fastApiKey = process.env.FAST_API_KEY;
  if (fastApiKey) {
    const fastBaseURL = process.env.FAST_BASE_URL;
    const fastModel = process.env.FAST_MODEL;
    const fastProviderType = process.env.FAST_PROVIDER || "openai";

    if (fastProviderType === "claude") {
      fastProvider = new ClaudeProvider({
        apiKey: fastApiKey,
        defaultModel: fastModel,
      });
    } else if (fastProviderType === "gemini") {
      fastProvider = new GeminiProvider({
        apiKey: fastApiKey,
        defaultModel: fastModel,
      });
    } else {
      fastProvider = new OpenAICompatibleProvider({
        apiKey: fastApiKey,
        baseURL: fastBaseURL,
        defaultModel: fastModel,
        providerName: "fast",
      });
    }
    fastProviderName = fastProviderType;
    fastModelName = fastModel;
    console.log(
      `[bootstrap] Fast provider: ${fastProviderType}, model: ${fastModel ?? "default"}`,
    );
  }

  // Tool registry
  const toolRegistry = new ToolRegistryImpl();
  const builtinTools = createBuiltinTools({
    gateway: true, // gateway 模式，启用 send_file/reminder/schedule
    memory: true, // 启用 remember
    planner: true, // 启用 plan_task
    skills: true, // 启用 use_skill
    delegate: true, // 启用 delegate_task（子 agent）
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
  try {
    mkdirSync(tempDir, { recursive: true });
  } catch {
    // may already exist
  }

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

  const shellDesc =
    shellInfo.name === "bash"
      ? process.platform === "win32"
        ? 'bash (Git Bash) by default. Use standard Unix/bash commands (ls, grep, cat, ffmpeg, etc.). For Windows-specific tasks (Recycle Bin, registry, WMI, system info), set the shell parameter to "powershell" and write native PowerShell syntax directly.'
        : "bash (Git Bash). Use standard Unix/bash commands (ls, grep, cat, ffmpeg, etc.)."
      : "PowerShell. Use PowerShell syntax (Get-ChildItem, $variable).";

  console.log(
    `[bootstrap] Shell: ${shellInfo.name} (${shellInfo.shell}), CLI tools: ${availableCli.join(", ") || "none detected"}`,
  );

  // Load system prompt from external file, with runtime variable substitution
  const systemPromptPath = resolve(
    process.cwd(),
    process.env.SYSTEM_PROMPT_FILE || "system-prompt.md",
  );
  let defaultSystemPrompt: string;

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
    // Load SOUL.md personality file
    const soulPath = resolve(process.cwd(), "data", "SOUL.md");
    let soul = "You are AgentClaw, a powerful AI assistant.";
    if (existsSync(soulPath)) {
      soul = readFileSync(soulPath, "utf-8").trim();
      console.log(`[bootstrap] Soul loaded from ${soulPath}`);
    }

    const vars: Record<string, string> = {
      soul,
      datetime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      os: osName,
      arch: arch(),
      shell: shellDesc,
      homedir: homedir(),
      tempdir: tempDir,
      availableCli: availableCli.join(", "),
      isWindows: os === "win32" ? "true" : "",
    };
    // Replace {{var}} placeholders
    defaultSystemPrompt = template.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => vars[key] ?? "",
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

  // Planner
  const planner = new SimplePlanner({
    provider,
    agentLoopFactory: (conversationId: string) => {
      const contextManager = new SimpleContextManager({
        memoryStore,
      });
      return new SimpleAgentLoop({
        provider,
        toolRegistry,
        contextManager,
        memoryStore,
      });
    },
  });

  // Orchestrator
  const tmpDir = resolve(process.cwd(), "data", "tmp");
  const orchestrator = new SimpleOrchestrator({
    provider,
    visionProvider,
    fastProvider,
    toolRegistry,
    memoryStore,
    systemPrompt: defaultSystemPrompt,
    scheduler,
    planner: {
      createPlan: (goal, ctx) => planner.createPlan(goal, ctx),
      executeNext: (planId) => planner.executeNext(planId),
    },
    skillRegistry,
    tmpDir,
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

  return {
    provider,
    visionProvider,
    orchestrator,
    planner,
    toolRegistry,
    memoryStore,
    skillRegistry,
    config,
    scheduler,
  };
}

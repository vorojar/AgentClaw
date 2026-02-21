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
  generateId,
} from "@agentclaw/providers";
import {
  ToolRegistryImpl,
  createBuiltinTools,
  shellInfo,
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
  databasePath: string;
  skillsDir: string;
}

function createProvider(): {
  provider: LLMProvider;
  providerName: string;
  model?: string;
} {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const model = process.env.DEFAULT_MODEL;
    return {
      provider: new ClaudeProvider({
        apiKey: anthropicKey,
        defaultModel: model,
      }),
      providerName: "claude",
      model,
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const model = process.env.DEFAULT_MODEL;
    const baseURL = process.env.OPENAI_BASE_URL;
    return {
      provider: new OpenAICompatibleProvider({
        apiKey: openaiKey,
        baseURL,
        defaultModel: model,
        providerName: "openai",
      }),
      providerName: "openai",
      model,
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const model = process.env.DEFAULT_MODEL;
    return {
      provider: new GeminiProvider({ apiKey: geminiKey, defaultModel: model }),
      providerName: "gemini",
      model,
    };
  }

  // Fallback: OpenAI-compatible with no key (e.g. local Ollama)
  const baseURL =
    process.env.OLLAMA_BASE_URL ||
    process.env.LLM_BASE_URL ||
    "http://localhost:11434/v1";
  const model =
    process.env.OLLAMA_MODEL || process.env.DEFAULT_MODEL || "llama3";
  return {
    provider: new OpenAICompatibleProvider({
      apiKey: "ollama",
      baseURL,
      defaultModel: model,
      providerName: "local",
    }),
    providerName: "local",
    model,
  };
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

  // Provider
  const { provider, providerName, model } = createProvider();

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

  // Tool registry
  const toolRegistry = new ToolRegistryImpl();
  const builtinTools = createBuiltinTools({
    gateway: true, // gateway 模式，启用 send_file/reminder/schedule
    memory: true, // 启用 remember
    planner: true, // 启用 plan_task
    skills: true, // 启用 use_skill
  });
  for (const tool of builtinTools) {
    toolRegistry.register(tool);
  }

  // Memory store
  const memoryStore = new SQLiteMemoryStore(db);
  if (provider.embed) {
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
  ];
  const availableCli: string[] = [];
  for (const tool of cliTools) {
    try {
      execFileSync(os === "win32" ? "where" : "which", [tool], {
        timeout: 2000,
        stdio: "ignore",
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
    const vars: Record<string, string> = {
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
  const orchestrator = new SimpleOrchestrator({
    provider,
    visionProvider,
    toolRegistry,
    memoryStore,
    systemPrompt: defaultSystemPrompt,
    scheduler,
    planner: {
      createPlan: (goal, ctx) => planner.createPlan(goal, ctx),
      executeNext: (planId) => planner.executeNext(planId),
    },
    skillRegistry,
  });

  const config: AppRuntimeConfig = {
    provider: providerName,
    model,
    visionProvider: visionProviderName,
    visionModel: visionModelName,
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

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
import { ToolRegistryImpl, createBuiltinTools } from "@agentclaw/tools";
import { initDatabase, SQLiteMemoryStore } from "@agentclaw/memory";
import type {
  LLMProvider,
  Orchestrator,
  Planner,
  SkillRegistry,
  ToolRegistry,
  MemoryStore,
} from "@agentclaw/types";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { platform, arch, homedir, tmpdir } from "os";
import { TaskScheduler } from "./scheduler.js";

export interface AppContext {
  provider: LLMProvider;
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

  // Tool registry
  const toolRegistry = new ToolRegistryImpl();
  const builtinTools = createBuiltinTools();
  for (const tool of builtinTools) {
    toolRegistry.register(tool);
  }

  // Memory store
  const memoryStore = new SQLiteMemoryStore(db);
  if (provider.embed) {
    memoryStore.setEmbedFn((texts) => provider.embed!(texts));
  }

  // Build system prompt with explicit tool descriptions for smaller models
  const toolDescriptions = toolRegistry
    .list()
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  // Detect runtime environment
  const os = platform();
  const osName =
    os === "win32" ? "Windows" : os === "darwin" ? "macOS" : "Linux";
  const shellName =
    os === "win32"
      ? "PowerShell (commands are executed via powershell.exe directly, $ variables work normally)"
      : "/bin/sh";
  const tempDir = resolve(process.cwd(), "data", "tmp");
  try {
    mkdirSync(tempDir, { recursive: true });
  } catch {
    // may already exist
  }

  const defaultSystemPrompt = `You are AgentClaw, a powerful AI assistant. You MUST use tools to help the user. Do NOT say you cannot do something — use the appropriate tool instead.

## Runtime Environment
- OS: ${osName} (${arch()})
- Shell: ${shellName}
- Home directory: ${homedir()}
- Temp directory for generated files: ${tempDir}

IMPORTANT: You are running on ${osName}. Always use ${osName}-compatible commands.${os === "win32" ? " The shell tool runs PowerShell directly. Use PowerShell syntax (e.g., Get-ChildItem, $variable). Do NOT use macOS/Linux commands like screencapture, pbcopy, etc." : ""}

## Available tools
${toolDescriptions}

## Rules
- When the user asks to search, use the "web_search" tool.
- When the user asks to read a file, use the "file_read" tool.
- When the user asks to write a file, use the "file_write" tool.
- When the user asks to fetch a URL, use the "web_fetch" tool.
- For complex tasks (screenshots, image processing, PDF/Excel, data analysis, file conversion, etc.), use the "python" tool. It directly executes Python code — no need to write files first.
- For simple system commands (list files, check processes, network info, etc.), use the "shell" tool.
- When generating files (images, documents, etc.), ALWAYS save them to: ${tempDir}
- After generating a file that the user needs (screenshot, document, image, etc.), ALWAYS send it via "send_file" immediately. Do not wait for the user to ask.
- Always respond in the same language the user uses.

## Style
- Be concise. Do not narrate your actions ("让我来...", "我现在要...").
- After sending a file, do NOT repeat metadata (resolution, file size, path). A brief confirmation is enough.
- Act directly. Minimize unnecessary explanation.`;

  // Scheduler
  const scheduler = new TaskScheduler();

  // Orchestrator
  const orchestrator = new SimpleOrchestrator({
    provider,
    toolRegistry,
    memoryStore,
    systemPrompt: process.env.SYSTEM_PROMPT || defaultSystemPrompt,
    scheduler,
  });

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

  // Skill registry
  const skillsDir = process.env.SKILLS_DIR || "./skills/";
  const skillRegistry = new SkillRegistryImpl();
  await skillRegistry.loadFromDirectory(skillsDir);

  const config: AppRuntimeConfig = {
    provider: providerName,
    model,
    databasePath,
    skillsDir,
  };

  return {
    provider,
    orchestrator,
    planner,
    toolRegistry,
    memoryStore,
    skillRegistry,
    config,
    scheduler,
  };
}

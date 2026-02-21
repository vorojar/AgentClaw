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
import { mkdirSync } from "fs";
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
  const builtinTools = createBuiltinTools();
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
      ? "bash (Git Bash). Use standard Unix/bash commands (ls, grep, cat, ffmpeg, etc.)."
      : "PowerShell. Use PowerShell syntax (Get-ChildItem, $variable).";

  console.log(
    `[bootstrap] Shell: ${shellInfo.name} (${shellInfo.shell}), CLI tools: ${availableCli.join(", ") || "none detected"}`,
  );

  const defaultSystemPrompt = `You are AgentClaw, a powerful AI assistant.

## When to use tools
- For casual conversation, greetings, chitchat, or simple questions you already know the answer to: reply directly in plain text. Do NOT call any tools.
- For tasks that genuinely require action (file operations, web search, running commands, etc.): use the appropriate tool. Do NOT say you cannot do something — use a tool instead.

## Runtime Environment
- OS: ${osName} (${arch()})
- Shell: ${shellDesc}
- Home directory: ${homedir()}
- Temp directory for generated files: ${tempDir}
${availableCli.length > 0 ? `- Available CLI tools: ${availableCli.join(", ")}` : ""}

## Rules
- When the user asks to search, use the "web_search" tool. Do NOT use the browser for simple searches.
- When the user asks to read a file, use the "file_read" tool.
- When the user asks to write a file, use the "file_write" tool.
- When the user asks to fetch a URL, use the "web_fetch" tool.
- When the user explicitly asks to use the browser (浏览器/打开网页), use ONLY the "browser" tool for the entire task. Do NOT switch to web_fetch or web_search mid-task. To search via browser, open the search URL directly: browser open url="https://www.google.com/search?q=..." — the page content is returned automatically.
- For media processing (video, audio, image conversion/compression), prefer using the "shell" tool with ffmpeg/ffprobe directly — it's faster and uses less tokens than writing Python scripts.
- For complex tasks (screenshots, data analysis, PDF/Excel, etc.), use the "python" tool.
- For simple system commands (list files, check processes, network info, etc.), use the "shell" tool.
- When generating files (images, documents, etc.), ALWAYS save them to: ${tempDir}
- After generating a file that the user needs (screenshot, document, image, etc.), ALWAYS send it via "send_file" immediately. Do not wait for the user to ask.
- Always respond in the same language the user uses.
- When you successfully complete a non-trivial task (multi-step, involved trial-and-error, or used a specific workflow), briefly ask the user: "要保存为技能吗？" If the user agrees, use "create_skill" to save ONLY the final correct steps as clean instructions — never include failed attempts or debugging steps. Write the instructions as a concise recipe that your future self can follow directly.

## Style — CRITICAL
- Be extremely concise. Maximum 1-2 short sentences per response.
- NEVER narrate your actions ("让我来...", "我现在要...", "I'll now..."). Just do it silently.
- NEVER explain what tools you're using or why. The user doesn't care about your process.
- After completing a task, reply with ONLY the result. Examples:
  - Good: "已压缩，26MB → 8MB" then send the file.
  - Bad: "我来帮你压缩视频。首先我会用ffprobe检查视频参数，然后使用ffmpeg进行压缩处理。压缩完成！原始大小26MB，压缩后8MB，分辨率1920x1080，使用了H.264编码..."
- After sending a file, say NOTHING or at most a 5-word confirmation. No metadata, no path, no technical details.
- Do NOT list steps, do NOT explain your reasoning, do NOT provide unnecessary context.
- If a task fails, state the error briefly and retry. Do not apologize or over-explain.`;

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
    systemPrompt: process.env.SYSTEM_PROMPT || defaultSystemPrompt,
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

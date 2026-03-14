/**
 * 统一配置模块：支持从 config.json / 环境变量 / .env 读取配置。
 * 优先级：环境变量 > config.json > .env > 默认值
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface AppConfig {
  // LLM
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  geminiApiKey?: string;
  defaultModel?: string;
  // Vision / Fast
  visionApiKey?: string;
  visionProvider?: string;
  visionModel?: string;
  fastApiKey?: string;
  fastProvider?: string;
  fastModel?: string;
  // Server
  port: number;
  host: string;
  apiKey?: string;
  // Paths
  dbPath: string;
  skillsDir: string;
  systemPromptFile: string;
  // Channels
  telegram?: { botToken: string };
  dingtalk?: { appKey: string; appSecret: string };
  feishu?: { appId: string; appSecret: string };
  qqBot?: { appId: string; appSecret: string };
  wecom?: { botId: string; botSecret: string };
  whatsapp?: { enabled: boolean };
  // Optional
  sentryDsn?: string;
  maxIterations?: number;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  volcanoEmbeddingKey?: string;
  searxngUrl?: string;
}

/** 环境变量名 → config 字段的映射表 */
const ENV_MAP: Record<string, string> = {
  ANTHROPIC_API_KEY: "anthropicApiKey",
  OPENAI_API_KEY: "openaiApiKey",
  OPENAI_BASE_URL: "openaiBaseUrl",
  GEMINI_API_KEY: "geminiApiKey",
  DEFAULT_MODEL: "defaultModel",
  VISION_API_KEY: "visionApiKey",
  VISION_PROVIDER: "visionProvider",
  VISION_MODEL: "visionModel",
  FAST_API_KEY: "fastApiKey",
  FAST_PROVIDER: "fastProvider",
  FAST_MODEL: "fastModel",
  PORT: "port",
  HOST: "host",
  API_KEY: "apiKey",
  DB_PATH: "dbPath",
  SKILLS_DIR: "skillsDir",
  SYSTEM_PROMPT_FILE: "systemPromptFile",
  TELEGRAM_BOT_TOKEN: "telegram.botToken",
  DINGTALK_APP_KEY: "dingtalk.appKey",
  DINGTALK_APP_SECRET: "dingtalk.appSecret",
  FEISHU_APP_ID: "feishu.appId",
  FEISHU_APP_SECRET: "feishu.appSecret",
  QQ_BOT_APP_ID: "qqBot.appId",
  QQ_BOT_APP_SECRET: "qqBot.appSecret",
  WECOM_BOT_ID: "wecom.botId",
  WECOM_BOT_SECRET: "wecom.botSecret",
  WHATSAPP_ENABLED: "whatsapp.enabled",
  SENTRY_DSN: "sentryDsn",
  MAX_ITERATIONS: "maxIterations",
  OLLAMA_BASE_URL: "ollamaBaseUrl",
  OLLAMA_MODEL: "ollamaModel",
  VOLCANO_EMBEDDING_KEY: "volcanoEmbeddingKey",
  SEARXNG_URL: "searxngUrl",
};

/** 反向映射：config 字段 → 环境变量名 */
const FIELD_TO_ENV: Record<string, string> = {};
for (const [env, field] of Object.entries(ENV_MAP)) {
  // 只映射顶层字段（不含 "."）
  if (!field.includes(".")) {
    FIELD_TO_ENV[field] = env;
  }
}

/** 默认配置值 */
const DEFAULTS: Partial<AppConfig> = {
  port: 3100,
  host: "0.0.0.0",
  dbPath: "./data/agentclaw.db",
  skillsDir: "./skills/",
  systemPromptFile: "system-prompt.md",
};

/** 需要解析为数字的字段 */
const NUMBER_FIELDS = new Set(["port", "maxIterations"]);

/** 需要解析为布尔值的字段 */
const BOOLEAN_FIELDS = new Set(["whatsapp.enabled"]);

/**
 * 获取 config.json 文件路径。
 * 可通过 CONFIG_PATH 环境变量覆盖，默认 ./data/config.json
 */
export function getConfigPath(): string {
  return resolve(
    process.cwd(),
    process.env.CONFIG_PATH || "./data/config.json",
  );
}

/**
 * 在嵌套对象上按点号路径设置值。
 * 例如 setNested(obj, "telegram.botToken", "xxx") → obj.telegram.botToken = "xxx"
 */
function setNested(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    obj[path] = value;
    return;
  }
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === undefined || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * 从嵌套对象按点号路径获取值。
 */
function _getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * 加载配置：合并 config.json + 环境变量 + 默认值。
 * config.json 不存在时不报错，走纯环境变量模式。
 */
export function loadConfig(configPath?: string): AppConfig {
  const path = configPath || getConfigPath();

  // 1. 从 config.json 读取基础配置
  let fileConfig: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      fileConfig = JSON.parse(raw) as Record<string, unknown>;
      console.log(`[config] Loaded from ${path}`);
    } catch (err) {
      console.warn(
        `[config] Failed to parse ${path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2. 用环境变量覆盖 config.json 中的值
  const merged: Record<string, unknown> = { ...fileConfig };
  for (const [envKey, fieldPath] of Object.entries(ENV_MAP)) {
    const envValue = process.env[envKey];
    if (envValue !== undefined && envValue !== "") {
      let value: unknown = envValue;
      if (NUMBER_FIELDS.has(fieldPath)) {
        value = parseInt(envValue, 10);
      } else if (BOOLEAN_FIELDS.has(fieldPath)) {
        value = envValue === "true";
      }
      setNested(merged, fieldPath, value);
    }
  }

  // 3. 填充默认值（仅对 undefined 的字段）
  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    if (merged[key] === undefined) {
      merged[key] = defaultValue;
    }
  }

  return merged as unknown as AppConfig;
}

/**
 * 保存配置到 config.json（合并写入，不是全量覆盖）。
 * 只写入传入的字段，不影响已有字段。
 */
export function saveConfig(
  config: Partial<AppConfig>,
  configPath?: string,
): void {
  const path = configPath || getConfigPath();

  // 读取已有配置
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // 文件损坏则覆盖
    }
  }

  // 合并新配置
  const updated = { ...existing, ...config };

  // 确保目录存在
  mkdirSync(dirname(path), { recursive: true });

  // 写入文件
  writeFileSync(path, JSON.stringify(updated, null, 2), "utf-8");
  console.log(`[config] Saved to ${path}`);
}

/**
 * 脱敏 API key：返回 "****xxxx" 格式（后4位）。
 * 空值返回空字符串。
 */
export function maskApiKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}

/** 需要脱敏的字段列表 */
const SENSITIVE_FIELDS = new Set([
  "anthropicApiKey",
  "openaiApiKey",
  "geminiApiKey",
  "visionApiKey",
  "fastApiKey",
  "apiKey",
  "sentryDsn",
  "volcanoEmbeddingKey",
]);

/**
 * 返回脱敏后的配置对象，适合通过 API 返回给前端。
 */
export function maskConfig(config: AppConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_FIELDS.has(key) && typeof value === "string") {
      result[key] = maskApiKey(value);
    } else if (key === "telegram" && value && typeof value === "object") {
      result[key] = {
        ...(value as Record<string, unknown>),
        botToken: maskApiKey(
          (value as Record<string, unknown>).botToken as string,
        ),
      };
    } else if (key === "dingtalk" && value && typeof value === "object") {
      result[key] = {
        ...(value as Record<string, unknown>),
        appSecret: maskApiKey(
          (value as Record<string, unknown>).appSecret as string,
        ),
      };
    } else if (key === "feishu" && value && typeof value === "object") {
      result[key] = {
        ...(value as Record<string, unknown>),
        appSecret: maskApiKey(
          (value as Record<string, unknown>).appSecret as string,
        ),
      };
    } else if (key === "qqBot" && value && typeof value === "object") {
      result[key] = {
        ...(value as Record<string, unknown>),
        appSecret: maskApiKey(
          (value as Record<string, unknown>).appSecret as string,
        ),
      };
    } else if (key === "wecom" && value && typeof value === "object") {
      result[key] = {
        ...(value as Record<string, unknown>),
        botSecret: maskApiKey(
          (value as Record<string, unknown>).botSecret as string,
        ),
      };
    } else {
      result[key] = value;
    }
  }
  return result;
}

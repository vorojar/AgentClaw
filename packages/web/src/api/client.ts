/**
 * API client for communicating with the AgentClaw Gateway.
 *
 * REST API endpoints:
 *   POST   /api/sessions              — Create session
 *   GET    /api/sessions              — List sessions
 *   DELETE /api/sessions/:id          — Close session
 *   POST   /api/sessions/:id/chat     — Send message (returns full response)
 *   GET    /api/sessions/:id/history  — Get conversation history
 *   GET    /api/memories              — Search memories
 *   GET    /api/tools                 — List tools
 *   GET    /api/skills                — List skills
 *   GET    /api/stats                 — Usage stats
 *   GET    /api/config                — Get config
 *   PUT    /api/config                — Update config
 *   GET    /api/tasks                 — List scheduled tasks
 *   POST   /api/tasks                 — Create scheduled task
 *   DELETE /api/tasks/:id             — Delete scheduled task
 *
 * WebSocket:
 *   ws://host/ws?sessionId=xxx
 *   Client sends: { type: "message", content: "..." }
 *   Server sends: { type: "text"|"tool_call"|"tool_result"|"done", ... }
 */

import { getStoredApiKey, clearStoredApiKey } from "../auth";

// In Tauri desktop, window.location is tauri://localhost — API calls must target the sidecar
const isTauri =
  window.location.protocol === "tauri:" ||
  window.location.hostname === "tauri.localhost";
const GATEWAY = isTauri ? "http://localhost:3100" : "";
const BASE = `${GATEWAY}/api`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }
  const apiKey = getStoredApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  // Merge caller headers (caller can override defaults)
  const callerHeaders = options?.headers;
  if (callerHeaders) {
    const entries =
      callerHeaders instanceof Headers
        ? Array.from(callerHeaders.entries())
        : Array.isArray(callerHeaders)
          ? callerHeaders
          : Object.entries(callerHeaders);
    for (const [k, v] of entries) {
      headers[k] = v;
    }
  }
  const { headers: _dropHeaders, ...restOptions } = options ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...restOptions,
    headers,
  });
  if (res.status === 401) {
    clearStoredApiKey();
    window.location.reload();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Sessions ────────────────────────────────────────

export type SessionStatus = "active" | "waiting" | "done";

export interface SessionInfo {
  id: string;
  conversationId: string;
  title?: string;
  status?: SessionStatus;
  agentId?: string;
  projectId?: string | null;
  preview?: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export function createSession(
  agentId?: string,
  projectId?: string,
): Promise<SessionInfo> {
  const body: Record<string, string> = {};
  if (agentId) body.agentId = agentId;
  if (projectId) body.projectId = projectId;
  return request("/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateSession(
  id: string,
  updates: {
    title?: string;
    status?: SessionStatus;
    projectId?: string | null;
  },
): Promise<SessionInfo> {
  return request(`/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

// ── Projects ──────────────────────────────────────

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  instructions: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
}

export function listProjects(): Promise<ProjectInfo[]> {
  return request("/projects");
}

export function getProject(id: string): Promise<ProjectInfo> {
  return request(`/projects/${encodeURIComponent(id)}`);
}

export function createProject(data: {
  name: string;
  description?: string;
  instructions?: string;
  color?: string;
}): Promise<ProjectInfo> {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateProject(
  id: string,
  updates: Partial<
    Pick<ProjectInfo, "name" | "description" | "instructions" | "color">
  >,
): Promise<ProjectInfo> {
  return request(`/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

// ── Agents ─────────────────────────────────────────

export interface AgentApiKeyInfo {
  keyId: string;
  key: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface HttpApiParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  in: "query" | "body" | "path";
}

export interface FileSourceConfigInfo {
  filename: string;
  storedPath: string;
  fileSize: number;
  chunkCount: number;
  chunkSize?: number;
  topK?: number;
}

export interface HttpApiConfigInfo {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  parameters: HttpApiParameter[];
  responseMapping?: string;
}

export interface KnowledgeSourceInfo {
  id: string;
  type: "http_api" | "file";
  name: string;
  description: string;
  config: HttpApiConfigInfo | FileSourceConfigInfo;
  enabled: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  avatar: string;
  soul?: string;
  model?: string;
  tools?: string[];
  maxIterations?: number;
  temperature?: number;
  sortOrder?: number;
  apiKeys?: AgentApiKeyInfo[];
  memoryNamespace?: string;
  disabledSkills?: string[];
  isPublished?: boolean;
  rateLimits?: { requestsPerMinute?: number; requestsPerDay?: number };
  knowledgeSources?: KnowledgeSourceInfo[];
  showInChat?: boolean;
  allowHandoff?: boolean;
}

export function listAgents(): Promise<AgentInfo[]> {
  return request("/agents");
}

export function createAgent(agent: AgentInfo): Promise<AgentInfo> {
  return request("/agents", {
    method: "POST",
    body: JSON.stringify(agent),
  });
}

export function updateAgent(
  id: string,
  updates: Partial<Omit<AgentInfo, "id">>,
): Promise<AgentInfo> {
  return request(`/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export function deleteAgent(id: string): Promise<void> {
  return request(`/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Agent API Key Management ─────────────────────────────
export function createAgentApiKey(
  agentId: string,
  name: string,
): Promise<AgentApiKeyInfo> {
  return request(`/agents/${encodeURIComponent(agentId)}/api-keys`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function listAgentApiKeys(agentId: string): Promise<AgentApiKeyInfo[]> {
  return request(`/agents/${encodeURIComponent(agentId)}/api-keys`);
}

export function deleteAgentApiKey(
  agentId: string,
  keyId: string,
): Promise<void> {
  return request(
    `/agents/${encodeURIComponent(agentId)}/api-keys/${encodeURIComponent(keyId)}`,
    { method: "DELETE" },
  );
}

// ─── Knowledge Source File Upload ─────────────────────────────
export async function uploadKnowledgeFile(
  agentId: string,
  file: File,
): Promise<KnowledgeSourceInfo & { chunkCount: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const headers: Record<string, string> = {};
  const apiKey = getStoredApiKey();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // Note: do NOT set Content-Type — browser sets it with boundary for multipart
  const resp = await fetch(
    `${BASE.replace(/\/api$/, "")}/api/agents/${encodeURIComponent(agentId)}/knowledge/upload`,
    {
      method: "POST",
      headers,
      body: formData,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || resp.statusText);
  }
  return resp.json();
}

export function deleteKnowledgeSource(
  agentId: string,
  sourceId: string,
): Promise<void> {
  return request(
    `/agents/${encodeURIComponent(agentId)}/knowledge/${encodeURIComponent(sourceId)}`,
    { method: "DELETE" },
  );
}

export function listSessions(projectId?: string): Promise<SessionInfo[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request(`/sessions${qs}`);
}

export function getActiveLoops(): Promise<string[]> {
  return request("/active-loops");
}

export function closeSession(id: string): Promise<void> {
  return request(`/sessions/${id}`, { method: "DELETE" });
}

export function renameSession(id: string, title: string): Promise<SessionInfo> {
  return request(`/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

// ── Chat ────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  toolCallCount?: number;
  createdAt: string;
  /** JSON-serialized tool calls (for assistant messages) */
  toolCalls?: string;
  /** JSON-serialized tool results (for tool messages) */
  toolResults?: string;
}

export function getHistory(
  sessionId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  const qs = limit ? `?limit=${limit}` : "";
  return request(`/sessions/${sessionId}/history${qs}`);
}

export function deleteTurnsFrom(
  sessionId: string,
  fromCreatedAt: string,
): Promise<{ deleted: number }> {
  return request(
    `/sessions/${sessionId}/turns?from=${encodeURIComponent(fromCreatedAt)}`,
    { method: "DELETE" },
  );
}

// ── Memory ──────────────────────────────────────────

export interface MemoryInfo {
  id: string;
  type: string;
  content: string;
  importance: number;
  namespace?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  accessedAt: string;
  accessCount: number;
}

export interface MemoryNamespaceInfo {
  namespace: string;
  count: number;
}

export function searchMemories(
  query?: string,
  type?: string,
  limit?: number,
  namespace?: string,
): Promise<MemoryInfo[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (type) params.set("type", type);
  if (limit) params.set("limit", String(limit));
  if (namespace) params.set("namespace", namespace);
  const qs = params.toString();
  return request(`/memories${qs ? `?${qs}` : ""}`);
}

export function deleteMemory(id: string): Promise<void> {
  return request(`/memories/${id}`, { method: "DELETE" });
}

export function updateMemory(
  id: string,
  updates: {
    type?: string;
    content?: string;
    importance?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<MemoryInfo> {
  return request(`/memories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deprecateMemory(
  id: string,
  reason?: string,
): Promise<MemoryInfo> {
  return request(`/memories/${encodeURIComponent(id)}/deprecate`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function mergeMemories(input: {
  sourceIds: string[];
  targetId?: string;
  content: string;
  type?: string;
  importance?: number;
  namespace?: string;
}): Promise<{ target: MemoryInfo; deprecatedIds: string[] }> {
  return request("/memories/merge", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getMemoryNamespaces(): Promise<MemoryNamespaceInfo[]> {
  return request("/memories/namespaces");
}

// ── Tools & Skills ──────────────────────────────────

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
  disabled?: boolean;
  permission?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export function listTools(): Promise<ToolInfo[]> {
  return request("/tools");
}

export function setToolDisabled(
  name: string,
  disabled: boolean,
): Promise<{ name: string; disabled: boolean }> {
  return request(`/tools/${encodeURIComponent(name)}/disabled`, {
    method: "PUT",
    body: JSON.stringify({ disabled }),
  });
}

export function listSkills(): Promise<SkillInfo[]> {
  return request("/skills");
}

export function updateSkillEnabled(
  id: string,
  enabled: boolean,
): Promise<{ id: string; enabled: boolean }> {
  return request(`/skills/${encodeURIComponent(id)}/enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

// ── Evolution Ledger ───────────────────────────────

export type EvolutionTargetType =
  | "skill"
  | "tool"
  | "prompt"
  | "memory_policy"
  | "eval"
  | "agent"
  | "other";

export type EvolutionRunStatus =
  | "proposed"
  | "baseline"
  | "applied"
  | "verified"
  | "failed"
  | "rolled_back";

export type EvolutionResult = "improved" | "neutral" | "regressed" | "unknown";

export type EvolutionEventType =
  | "proposal"
  | "baseline_eval"
  | "backup"
  | "change"
  | "static_check"
  | "capability_eval"
  | "online_regression"
  | "promote"
  | "rollback"
  | "failure";

export interface EvolutionRunInfo {
  id: string;
  targetType: EvolutionTargetType;
  targetId: string;
  status: EvolutionRunStatus;
  result: EvolutionResult;
  reason?: string;
  triggerTraceId?: string;
  triggerConversationId?: string;
  baselineScore?: number;
  afterScore?: number;
  regressionCount: number;
  evalReportPath?: string;
  rollbackPath?: string;
  agentId?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface EvolutionEventInfo {
  id: string;
  runId: string;
  eventType: EvolutionEventType;
  message?: string;
  success: boolean;
  traceId?: string;
  changeId?: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  scoreBefore?: number;
  scoreAfter?: number;
  data?: Record<string, unknown>;
  createdAt: string;
}

export function listEvolutionRuns(params?: {
  targetType?: EvolutionTargetType;
  targetId?: string;
  status?: EvolutionRunStatus;
  triggerTraceId?: string;
  triggerConversationId?: string;
  limit?: number;
}): Promise<EvolutionRunInfo[]> {
  const qs = new URLSearchParams();
  if (params?.targetType) qs.set("targetType", params.targetType);
  if (params?.targetId) qs.set("targetId", params.targetId);
  if (params?.status) qs.set("status", params.status);
  if (params?.triggerTraceId) qs.set("triggerTraceId", params.triggerTraceId);
  if (params?.triggerConversationId) {
    qs.set("triggerConversationId", params.triggerConversationId);
  }
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  return request(`/evolution/runs${suffix}`);
}

export function listEvolutionEvents(params?: {
  runId?: string;
  traceId?: string;
  limit?: number;
}): Promise<EvolutionEventInfo[]> {
  const qs = new URLSearchParams();
  if (params?.runId) qs.set("runId", params.runId);
  if (params?.traceId) qs.set("traceId", params.traceId);
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  return request(`/evolution/events${suffix}`);
}

// ── Skill Import / Delete ──────────────────────────

export function importSkillFromGithub(
  url: string,
): Promise<{ success: boolean; skill: SkillInfo }> {
  return request("/skills/import/github", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function importSkillFromZip(
  file: File,
): Promise<{ success: boolean; skill: SkillInfo }> {
  // Cannot use request() — it auto-sets Content-Type: application/json.
  // FormData needs the browser to set the boundary automatically.
  const formData = new FormData();
  formData.append("file", file);
  const headers: Record<string, string> = {};
  const apiKey = getStoredApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${BASE}/skills/import/zip`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (res.status === 401) {
    clearStoredApiKey();
    window.location.reload();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export function deleteSkill(id: string): Promise<{ success: boolean }> {
  return request(`/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Stats & Config ──────────────────────────────────

export interface UsageStatsInfo {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalCalls: number;
  byModel: Array<{
    provider: string;
    model: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    callCount: number;
  }>;
}

export function getStats(): Promise<UsageStatsInfo> {
  return request("/stats");
}

/** LLM Provider 实例 */
export interface ProviderInstance {
  id: string;
  type: "openai" | "claude" | "gemini";
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
}

export interface AppConfigInfo {
  provider: string;
  model?: string;
  databasePath: string;
  skillsDir: string;
  dailyBriefTime?: string;
  dailyBriefEnabled?: boolean;
  // 多 Provider 实例
  providers?: ProviderInstance[];
  activeProvider?: string;
  // Vision / Fast
  visionApiKey?: string;
  visionProvider?: string;
  visionModel?: string;
  fastApiKey?: string;
  fastProvider?: string;
  fastModel?: string;
  // Server
  port?: number;
  host?: string;
  apiKey?: string;
  dbPath?: string;
  systemPromptFile?: string;
  // Channels
  telegram?: { botToken?: string };
  dingtalk?: { appKey?: string; appSecret?: string };
  feishu?: { appId?: string; appSecret?: string };
  qqBot?: { appId?: string; appSecret?: string };
  wecom?: { botId?: string; botSecret?: string };
  whatsapp?: { enabled?: boolean };
  email?: {
    imapHost?: string;
    smtpHost?: string;
    user?: string;
    password?: string;
  };
  // Search engines
  searchEngines?: SearchEngineConfig[];
  // Optional
  maxIterations?: number;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  volcanoEmbeddingKey?: string;
}

/** 搜索引擎配置 */
export interface SearchEngineConfig {
  id: string;
  type: "searxng" | "serper" | "querit" | "custom";
  name: string;
  enabled: boolean;
  url?: string;
  apiKey?: string;
}

export function getConfig(): Promise<AppConfigInfo> {
  return request("/config");
}

export function updateConfig(
  updates: Partial<Pick<AppConfigInfo, "model" | "dailyBriefTime">>,
): Promise<AppConfigInfo> {
  return request("/config", {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

/** 更新应用配置（写入 config.json） */
export function updateAppConfig(
  config: Partial<AppConfigInfo>,
): Promise<AppConfigInfo> {
  return request("/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/** 验证 LLM API key 有效性 */
interface ValidateParams {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface ValidateResult {
  valid: boolean;
  error?: string;
}

export function validateApiKey(
  params: ValidateParams,
): Promise<ValidateResult> {
  return request("/config/validate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function testSearchEngine(params: {
  type: string;
  url?: string;
  apiKey?: string;
}): Promise<{ success: boolean; error?: string }> {
  return request("/config/test-search", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ── Traces ─────────────────────────────────────────

export interface TraceStep {
  type: "llm_call" | "tool_call" | "tool_result";
  iteration?: number;
  tokensIn?: number;
  tokensOut?: number;
  stopReason?: string;
  error?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface TraceInfo {
  id: string;
  conversationId: string;
  userInput: string;
  systemPrompt?: string;
  skillMatch?: string;
  steps: TraceStep[] | string;
  response?: string;
  model?: string;
  channel?: string;
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  durationMs: number;
  error?: string;
  createdAt: string;
}

interface TracesResponse {
  items: TraceInfo[];
  total: number;
}

export function getTraces(
  limit = 20,
  offset = 0,
  agentId?: string,
): Promise<TracesResponse> {
  const qs = agentId ? `&agentId=${encodeURIComponent(agentId)}` : "";
  return request(`/traces?limit=${limit}&offset=${offset}${qs}`);
}

export interface AgentUsageInfo {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  avgDurationMs: number;
}

export function getAgentUsage(
  agentId: string,
  hours = 24,
): Promise<AgentUsageInfo> {
  return request(`/agents/${encodeURIComponent(agentId)}/usage?hours=${hours}`);
}

// ── Scheduled Tasks ─────────────────────────────────

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  cron: string;
  status?: "idle" | "running";
  action: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export async function listScheduledTasks(): Promise<ScheduledTaskInfo[]> {
  try {
    const res = await request<unknown>("/tasks/scheduled");
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

export function createScheduledTask(
  task: Omit<ScheduledTaskInfo, "id" | "lastRunAt" | "nextRunAt">,
): Promise<ScheduledTaskInfo> {
  return request("/tasks/scheduled", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function updateScheduledTask(
  id: string,
  updates: Partial<
    Pick<ScheduledTaskInfo, "name" | "cron" | "action" | "enabled">
  >,
): Promise<ScheduledTaskInfo> {
  return request(`/tasks/scheduled/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export function runScheduledTask(id: string): Promise<ScheduledTaskInfo> {
  return request(`/tasks/scheduled/${id}/run`, { method: "POST" });
}

export function deleteScheduledTask(id: string): Promise<void> {
  return request(`/tasks/scheduled/${id}`, { method: "DELETE" });
}

// ── SubAgents ──────────────────────────────────────

export interface SubAgentInfo {
  id: string;
  sessionId?: string;
  goal: string;
  model?: string;
  status: "running" | "completed" | "failed" | "killed";
  result?: string;
  error?: string;
  tokensIn: number;
  tokensOut: number;
  toolsUsed: string[];
  iterations: number;
  createdAt: string;
  completedAt?: string;
}

export function listSubAgents(
  status?: string,
  limit = 20,
  offset = 0,
): Promise<{ items: SubAgentInfo[]; total: number }> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return request(`/subagents?${params}`);
}

// ── Channels ───────────────────────────────────────

export interface ChannelInfo {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "error" | "not_configured";
  statusMessage?: string;
  connectedAt?: string;
}

export function listChannels(): Promise<ChannelInfo[]> {
  return request("/channels");
}

export function startChannel(id: string): Promise<ChannelInfo> {
  return request(`/channels/${id}/start`, { method: "POST" });
}

export function stopChannel(id: string): Promise<ChannelInfo> {
  return request(`/channels/${id}/stop`, { method: "POST" });
}

// ── Upload ─────────────────────────────────────────

export async function uploadFile(
  file: File,
): Promise<{ url: string; filename: string; path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const apiKey = getStoredApiKey();
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${GATEWAY}/api/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }
  return res.json();
}

// ── Task Runner Stats ────────────────────────────────

export interface TaskRunnerStats {
  sessions: number;
  traces: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export function getTaskRunnerStats(since?: string): Promise<TaskRunnerStats> {
  const params = since ? `?since=${encodeURIComponent(since)}` : "";
  return request(`/task-runner-stats${params}`);
}

// ── WebSocket ───────────────────────────────────────

export interface WSMessage {
  type:
    | "text"
    | "tool_call"
    | "tool_result"
    | "tool_progress"
    | "done"
    | "error"
    | "file"
    | "broadcast"
    | "prompt"
    | "todo_update"
    | "session_activity"
    | "resuming"
    | "stopped"
    | "thinking"
    | "handoff";
  sessionId?: string;
  channel?: string;
  text?: string;
  fromAgent?: string;
  toAgent?: string;
  toAgentName?: string;
  reason?: string;
  intent?: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  isError?: boolean;
  error?: string;
  url?: string;
  filename?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  toolCallCount?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  success?: boolean;
  question?: string;
  agentId?: string;
}

export function connectWebSocket(
  sessionId: string,
  onMessage: (msg: WSMessage) => void,
  onClose?: () => void,
  onOpen?: () => void,
): {
  send: (content: string, skillName?: string) => void;
  stop: () => void;
  close: () => void;
  promptReply: (content: string) => void;
} {
  const wsHost = isTauri ? "localhost:3100" : window.location.host;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let wsUrl = `${protocol}//${wsHost}/ws?sessionId=${sessionId}`;
  const apiKey = getStoredApiKey();
  if (apiKey) {
    wsUrl += `&token=${encodeURIComponent(apiKey)}`;
  }
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => onOpen?.();

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WSMessage;
      onMessage(msg);
    } catch {
      // ignore malformed messages
    }
  };

  ws.onerror = () => ws.close();
  ws.onclose = () => onClose?.();

  return {
    send(content: string, skillName?: string) {
      if (ws.readyState === WebSocket.OPEN) {
        const msg: Record<string, string> = { type: "message", content };
        if (skillName) msg.skillName = skillName;
        ws.send(JSON.stringify(msg));
      }
    },
    stop() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stop" }));
      }
    },
    close() {
      ws.close();
    },
    promptReply(content: string) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "prompt_reply", content }));
      }
    },
  };
}

// ── Task Manager v2 ─────────────────────────────────

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: string; // todo | queued | running | done | failed | waiting_decision
  priority: string; // high | medium | low
  dueDate: string | null;
  assignee: string;
  createdBy: string;
  executor: string;
  source: string;
  deadline: string | null;
  result: string | null;
  decisionContext: string | null;
  decisionOptions: string[] | null;
  decisionResult: string | null;
  progress: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStats {
  inbox: number;
  queued: number;
  running: number;
  waiting_decision: number;
  done_today: number;
  total_pending: number;
  triaged: number;
  blocked: number;
}

interface TaskListResponse {
  items: TaskItem[];
  total: number;
  stats: TaskStats;
}

export async function listManagedTasks(params?: {
  status?: string;
  executor?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}): Promise<TaskListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.executor) qs.set("executor", params.executor);
  if (params?.priority) qs.set("priority", params.priority);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return request<TaskListResponse>(`/tasks${q ? `?${q}` : ""}`);
}

export async function createManagedTask(data: {
  text?: string;
  task?: {
    title: string;
    description?: string;
    priority?: string;
    deadline?: string;
    executor?: string;
    dueDate?: string;
  };
}): Promise<TaskItem> {
  return request<TaskItem>("/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateManagedTask(
  id: string,
  updates: Partial<
    Pick<
      TaskItem,
      | "title"
      | "description"
      | "status"
      | "priority"
      | "dueDate"
      | "executor"
      | "deadline"
      | "progress"
    >
  >,
): Promise<TaskItem> {
  return request<TaskItem>(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteManagedTask(id: string): Promise<void> {
  return request<void>(`/tasks/${id}`, { method: "DELETE" });
}

export async function submitDecision(
  id: string,
  decision: string,
): Promise<{ task: TaskItem | null }> {
  return request<{ task: TaskItem | null }>(`/tasks/${id}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

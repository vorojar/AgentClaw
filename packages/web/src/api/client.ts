/**
 * API client for communicating with the AgentClaw Gateway.
 *
 * REST API endpoints:
 *   POST   /api/sessions              — Create session
 *   GET    /api/sessions              — List sessions
 *   DELETE /api/sessions/:id          — Close session
 *   POST   /api/sessions/:id/chat     — Send message (returns full response)
 *   GET    /api/sessions/:id/history  — Get conversation history
 *   GET    /api/plans                 — List plans
 *   GET    /api/plans/:id             — Get plan detail
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

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }
  const apiKey = getStoredApiKey();
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
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

export interface SessionInfo {
  id: string;
  conversationId: string;
  title?: string;
  createdAt: string;
  lastActiveAt: string;
}

export function createSession(): Promise<SessionInfo> {
  return request("/sessions", { method: "POST" });
}

export function listSessions(): Promise<SessionInfo[]> {
  return request("/sessions");
}

export function closeSession(id: string): Promise<void> {
  return request(`/sessions/${id}`, { method: "DELETE" });
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

export function sendMessage(
  sessionId: string,
  content: string,
): Promise<{ message: ChatMessage }> {
  return request(`/sessions/${sessionId}/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function getHistory(
  sessionId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  const qs = limit ? `?limit=${limit}` : "";
  return request(`/sessions/${sessionId}/history${qs}`);
}

// ── Plans ───────────────────────────────────────────

export interface PlanInfo {
  id: string;
  goal: string;
  status: string;
  steps: Array<{
    id: string;
    description: string;
    status: string;
    result?: string;
    error?: string;
  }>;
  createdAt: string;
  completedAt?: string;
}

export function listPlans(): Promise<PlanInfo[]> {
  return request("/plans");
}

export function getPlan(id: string): Promise<PlanInfo> {
  return request(`/plans/${id}`);
}

// ── Memory ──────────────────────────────────────────

export interface MemoryInfo {
  id: string;
  type: string;
  content: string;
  importance: number;
  createdAt: string;
  accessedAt: string;
  accessCount: number;
}

export function searchMemories(
  query?: string,
  type?: string,
  limit?: number,
): Promise<MemoryInfo[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (type) params.set("type", type);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return request(`/memories${qs ? `?${qs}` : ""}`);
}

export function deleteMemory(id: string): Promise<void> {
  return request(`/memories/${id}`, { method: "DELETE" });
}

// ── Tools & Skills ──────────────────────────────────

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
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
    headers["Authorization"] = `Bearer ${apiKey}`;
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

export interface AppConfigInfo {
  provider: string;
  model?: string;
  databasePath: string;
  skillsDir: string;
}

export function getConfig(): Promise<AppConfigInfo> {
  return request("/config");
}

export function updateConfig(
  updates: Partial<AppConfigInfo>,
): Promise<AppConfigInfo> {
  return request("/config", {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

// ── Token Logs ─────────────────────────────────────

export interface TokenLogEntry {
  id: string;
  conversationId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  traceId: string | null;
  createdAt: string;
}

export interface TokenLogsResponse {
  items: TokenLogEntry[];
  total: number;
}

export function getTokenLogs(
  limit = 50,
  offset = 0,
): Promise<TokenLogsResponse> {
  return request(`/token-logs?limit=${limit}&offset=${offset}`);
}

// ── Traces ─────────────────────────────────────────

export interface TraceStep {
  type: "llm_call" | "tool_call" | "tool_result";
  iteration?: number;
  tokensIn?: number;
  tokensOut?: number;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
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
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error?: string;
  createdAt: string;
}

export interface TracesResponse {
  items: TraceInfo[];
  total: number;
}

export function getTraces(limit = 20, offset = 0): Promise<TracesResponse> {
  return request(`/traces?limit=${limit}&offset=${offset}`);
}

export function getTrace(id: string): Promise<TraceInfo> {
  return request(`/traces/${id}`);
}

// ── Scheduled Tasks ─────────────────────────────────

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  cron: string;
  action: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export function listScheduledTasks(): Promise<ScheduledTaskInfo[]> {
  return request("/tasks");
}

export function createScheduledTask(
  task: Omit<ScheduledTaskInfo, "id" | "lastRunAt" | "nextRunAt">,
): Promise<ScheduledTaskInfo> {
  return request("/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function deleteScheduledTask(id: string): Promise<void> {
  return request(`/tasks/${id}`, { method: "DELETE" });
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
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const res = await fetch("/api/upload", {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }
  return res.json();
}

// ── WebSocket ───────────────────────────────────────

export interface WSMessage {
  type:
    | "text"
    | "tool_call"
    | "tool_result"
    | "done"
    | "error"
    | "file"
    | "broadcast";
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  error?: string;
  url?: string;
  filename?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  toolCallCount?: number;
}

export function connectWebSocket(
  sessionId: string,
  onMessage: (msg: WSMessage) => void,
  onClose?: () => void,
  onOpen?: () => void,
): {
  send: (content: string) => void;
  stop: () => void;
  close: () => void;
} {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${sessionId}`;
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

  ws.onclose = () => onClose?.();

  return {
    send(content: string) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "message", content }));
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
  };
}

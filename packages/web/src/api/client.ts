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

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Sessions ────────────────────────────────────────

export interface SessionInfo {
  id: string;
  conversationId: string;
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

// ── WebSocket ───────────────────────────────────────

export interface WSMessage {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  error?: string;
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
): {
  send: (content: string) => void;
  close: () => void;
} {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${protocol}//${window.location.host}/ws?sessionId=${sessionId}`,
  );

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
      ws.send(JSON.stringify({ type: "message", content }));
    },
    close() {
      ws.close();
    },
  };
}

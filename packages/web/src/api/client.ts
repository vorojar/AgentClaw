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

export interface SessionInfo {
  id: string;
  conversationId: string;
  title?: string;
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
  updates: { title?: string; projectId?: string | null },
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

export function deleteProject(id: string): Promise<void> {
  return request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Agents ─────────────────────────────────────────

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
  dailyBriefTime?: string;
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

interface TokenLogsResponse {
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

export function getTraces(limit = 20, offset = 0): Promise<TracesResponse> {
  return request(`/traces?limit=${limit}&offset=${offset}`);
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

export function deleteScheduledTask(id: string): Promise<void> {
  return request(`/tasks/scheduled/${id}`, { method: "DELETE" });
}

// ── Todos (Task Management) ──────────────────────────

export interface TodoInfo {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  dueDate?: string;
  assignee: string;
  createdBy: string;
  sessionId?: string;
  traceId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function listTodos(
  status?: string,
  priority?: string,
  limit = 100,
  offset = 0,
): Promise<{ items: TodoInfo[]; total: number }> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return request(`/todos?${params}`);
}

export function createTodo(
  todo: Pick<TodoInfo, "title"> &
    Partial<
      Pick<
        TodoInfo,
        "description" | "priority" | "dueDate" | "assignee" | "tags"
      >
    >,
): Promise<TodoInfo> {
  return request("/todos", {
    method: "POST",
    body: JSON.stringify(todo),
  });
}

export function updateTodo(
  id: string,
  updates: Partial<
    Pick<
      TodoInfo,
      | "title"
      | "description"
      | "status"
      | "priority"
      | "dueDate"
      | "assignee"
      | "tags"
    >
  >,
): Promise<{ success: boolean }> {
  return request(`/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deleteTodo(id: string): Promise<void> {
  return request(`/todos/${id}`, { method: "DELETE" });
}

// ── Calendar ───────────────────────────────────────

export interface CalendarItem {
  date: string;
  type: "task" | "schedule";
  id: string;
  title: string;
  status?: string;
  priority?: string;
  cron?: string;
}

export function getCalendar(
  year: number,
  month: number,
): Promise<{ year: number; month: number; items: CalendarItem[] }> {
  return request(`/calendar?year=${year}&month=${month}`);
}

// ── Google Tasks ─────────────────────────────────

export interface GoogleTask {
  id: string;
  title: string;
  notes: string;
  status: "needsAction" | "completed";
  due?: string;
  updated: string;
  parent?: string;
  position: string;
}

export function listGoogleTasks(
  tasklist = "@default",
  showCompleted = false,
): Promise<{ items: GoogleTask[] }> {
  const params = new URLSearchParams({
    tasklist,
    showCompleted: String(showCompleted),
  });
  return request(`/google-tasks?${params}`);
}

export function createGoogleTask(task: {
  title: string;
  notes?: string;
  due?: string;
  tasklist?: string;
}): Promise<GoogleTask> {
  return request("/google-tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function updateGoogleTask(
  id: string,
  updates: Partial<Pick<GoogleTask, "title" | "notes" | "status" | "due">> & {
    tasklist?: string;
  },
): Promise<GoogleTask> {
  return request(`/google-tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deleteGoogleTask(
  id: string,
  tasklist = "@default",
): Promise<void> {
  return request(`/google-tasks/${id}?tasklist=${tasklist}`, {
    method: "DELETE",
  });
}

// ── Google Calendar ──────────────────────────────

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  htmlLink?: string;
}

export function listGoogleCalendarEvents(
  days = 14,
): Promise<{ items: GoogleCalendarEvent[] }> {
  return request(`/google-calendar?days=${days}`);
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

export function getSubAgent(id: string): Promise<SubAgentInfo> {
  return request(`/subagents/${id}`);
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
    | "done"
    | "error"
    | "file"
    | "broadcast"
    | "prompt"
    | "todo_update"
    | "session_activity"
    | "resuming"
    | "handoff";
  text?: string;
  fromAgent?: string;
  toAgent?: string;
  toAgentName?: string;
  reason?: string;
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
  question?: string;
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

export interface TaskListResponse {
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

export async function getTaskStats(): Promise<TaskStats> {
  // Note: this may shadow the existing getTaskRunnerStats - use different name
  return request<TaskStats>("/tasks/stats");
}

export async function getTaskBrief(): Promise<{
  brief: string | null;
  stats?: TaskStats;
}> {
  return request<{ brief: string | null; stats?: TaskStats }>("/tasks/brief");
}

export async function getTaskDetail(id: string): Promise<TaskItem> {
  return request<TaskItem>(`/tasks/${id}`);
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

export async function executeTask(
  id: string,
): Promise<{ result: unknown; task: TaskItem | null }> {
  return request<{ result: unknown; task: TaskItem | null }>(
    `/tasks/${id}/execute`,
    {
      method: "POST",
    },
  );
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

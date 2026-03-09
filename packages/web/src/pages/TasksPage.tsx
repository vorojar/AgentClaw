import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import {
  listManagedTasks,
  createManagedTask,
  updateManagedTask,
  deleteManagedTask,
  submitDecision,
  listScheduledTasks,
  createScheduledTask,
  deleteScheduledTask,
  getTaskRunnerStats,
  getConfig,
  updateConfig,
  type TaskItem,
  type TaskStats,
  type TaskRunnerStats,
  type ScheduledTaskInfo,
} from "../api/client";
import "./TasksPage.css";

// ── Helpers ──────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('time.justNow');
  if (mins < 60) return t('time.minsAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('time.hoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  return t('time.daysAgo', { count: days });
}

const EXECUTOR_ICON: Record<string, string> = {
  agent: "\u{1F916}",
  human: "\u{1F464}",
};

// ── Stats Bar ────────────────────────────────────────

function StatsBar({ stats }: { stats: TaskStats }) {
  const { t } = useTranslation();
  return (
    <div className="tm-stats-bar">
      <div className="tm-stat">
        <span className="tm-stat-value">{stats.total_pending}</span>
        <span className="tm-stat-label">{t('tasks.pending')}</span>
      </div>
      <div className="tm-stat">
        <span className="tm-stat-value">{stats.running}</span>
        <span className="tm-stat-label">{t('tasks.running')}</span>
      </div>
      <div className="tm-stat">
        <span className="tm-stat-value">{stats.queued}</span>
        <span className="tm-stat-label">{t('tasks.queued')}</span>
      </div>
      <div className="tm-stat">
        <span className="tm-stat-value">{stats.waiting_decision}</span>
        <span className="tm-stat-label">{t('tasks.decisions')}</span>
      </div>
      <div className="tm-stat">
        <span className="tm-stat-value">{stats.done_today}</span>
        <span className="tm-stat-label">{t('tasks.doneLabel')}</span>
      </div>
    </div>
  );
}

// ── Quick Add ────────────────────────────────────────

function QuickAdd({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await onAdd(text.trim());
      setText("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tm-quick-add">
      <input
        type="text"
        className="tm-quick-input"
        placeholder={t('tasks.addPlaceholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        disabled={saving}
      />
      <button
        className="btn-primary tm-quick-btn"
        onClick={handleSubmit}
        disabled={saving || !text.trim()}
      >
        {saving ? "..." : t('common.add')}
      </button>
    </div>
  );
}

// ── Task Card (shared) ──────────────────────────────

function ManagedTaskCard({
  task,
  onUpdate,
  onDelete,
  onDecide,
  compact,
}: {
  task: TaskItem;
  onUpdate: (id: string, updates: Partial<TaskItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDecide?: (id: string, decision: string) => Promise<void>;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const isDone = task.status === "done";
  const isFailed = task.status === "failed";
  const isRunning = task.status === "running";
  const isDecision = task.status === "waiting_decision";

  const handleToggleDone = async () => {
    setBusy(true);
    try {
      if (isDone) {
        await onUpdate(task.id, { status: "todo" });
      } else {
        await onUpdate(task.id, { status: "done" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDel) {
      setConfirmDel(true);
      return;
    }
    setBusy(true);
    try {
      await onDelete(task.id);
    } finally {
      setBusy(false);
      setConfirmDel(false);
    }
  };

  return (
    <div
      className={`tasks-card ${isDone ? "tasks-card-completed" : ""} ${isFailed ? "tasks-card-failed" : ""} ${isDecision ? "tasks-card-decision" : ""}`}
    >
      <div className="tasks-card-header">
        {!isRunning && !isDecision && (
          <button
            className={`tasks-check-btn ${isDone ? "checked" : ""}`}
            onClick={handleToggleDone}
            disabled={busy}
          >
            {isDone ? "\u2713" : "\u25CB"}
          </button>
        )}
        {isRunning && <span className="tm-spinner" />}
        {isDecision && <span className="tm-decision-icon">?</span>}
        <span
          className={`tasks-card-title ${isDone ? "tasks-title-done" : ""}`}
        >
          {task.title}
        </span>
        {!compact && (
          <span className="tm-executor-badge">
            {EXECUTOR_ICON[task.executor] || EXECUTOR_ICON[task.assignee] || ""}
          </span>
        )}
      </div>

      {task.description && !compact && (
        <div className="tasks-card-desc">{task.description}</div>
      )}

      {isRunning && task.progress > 0 && (
        <div className="tm-progress-bar">
          <div
            className="tm-progress-fill"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      )}

      {isDecision && task.decisionContext && (
        <div className="tm-decision-context">{task.decisionContext}</div>
      )}

      {isFailed && task.result && (
        <div className="tm-error-msg">{task.result}</div>
      )}

      {isDone && task.result && !compact && (
        <div className="tm-result-msg">{task.result.slice(0, 150)}</div>
      )}

      <div className="tasks-card-footer">
        <span
          className={`tm-priority-dot tm-priority-${task.priority}`}
          title={t(`priority.${task.priority === 'medium' ? 'normal' : task.priority}`)}
        />
        {task.status !== "done" && task.status !== "failed" && (
          <span className="tm-status-badge">
            {t(`status.${task.status}`, task.status)}
          </span>
        )}
        {(task.deadline || task.dueDate) && (
          <span className="tasks-card-due">
            {formatDate(task.deadline || task.dueDate)}
          </span>
        )}
        <span className="tm-time-ago">{relativeTime(task.createdAt, t)}</span>
        <div className="tasks-card-spacer" />
        {confirmDel ? (
          <span className="tasks-card-delete-confirm">
            <button
              className="btn-danger tasks-card-btn"
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? "..." : t('common.yes')}
            </button>
            <button
              className="btn-secondary tasks-card-btn"
              onClick={() => setConfirmDel(false)}
            >
              {t('common.no')}
            </button>
          </span>
        ) : (
          <button
            className="tasks-card-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            title={t('common.delete')}
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}

// ── Decision Card ───────────────────────────────────

function DecisionCard({
  task,
  onDecide,
}: {
  task: TaskItem;
  onDecide: (id: string, decision: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const handleDecide = async (decision: string) => {
    setBusy(true);
    try {
      await onDecide(task.id, decision);
    } finally {
      setBusy(false);
    }
  };

  const raw = task.decisionOptions || [];
  const options: string[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : [];

  return (
    <div className="tm-decision-card">
      <div className="tm-decision-title">{task.title}</div>
      {task.decisionContext && (
        <div className="tm-decision-body">{task.decisionContext}</div>
      )}
      {options.length > 0 && (
        <div className="tm-decision-options">
          {options.map((opt, i) => (
            <button
              key={i}
              className="btn-secondary tm-decision-opt-btn"
              onClick={() => handleDecide(opt)}
              disabled={busy}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="tm-decision-input-row">
        <input
          type="text"
          className="tm-decision-input"
          placeholder={t('tasks.orTypeDecision')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && input.trim() && handleDecide(input.trim())
          }
          disabled={busy}
        />
        <button
          className="btn-primary tm-quick-btn"
          onClick={() => input.trim() && handleDecide(input.trim())}
          disabled={busy || !input.trim()}
        >
          {t('common.submit')}
        </button>
      </div>
    </div>
  );
}

// ── Today View ──────────────────────────────────────

function TodayView({
  tasks,
  stats,
  onUpdate,
  onDelete,
  onDecide,
  onAdd,
}: {
  tasks: TaskItem[];
  stats: TaskStats | null;
  onUpdate: (id: string, updates: Partial<TaskItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDecide: (id: string, decision: string) => Promise<void>;
  onAdd: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const decisions = tasks.filter((t) => t.status === "waiting_decision");
  const running = tasks.filter((t) => t.status === "running");
  const queued = tasks.filter((t) => t.status === "queued");
  const todos = tasks.filter(
    (t) => t.status === "todo" || t.status === "inbox",
  );
  const doneToday = tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completedAt &&
      t.completedAt.startsWith(new Date().toISOString().slice(0, 10)),
  );

  return (
    <div className="tm-today">
      {stats && <StatsBar stats={stats} />}

      {decisions.length > 0 && (
        <div className="tasks-section">
          <h3 className="tasks-section-title">
            {t('tasks.needsDecision')}
            <span className="tasks-column-count">{decisions.length}</span>
          </h3>
          <div className="tm-decision-list">
            {decisions.map((t) => (
              <DecisionCard key={t.id} task={t} onDecide={onDecide} />
            ))}
          </div>
        </div>
      )}

      {running.length > 0 && (
        <div className="tasks-section">
          <h3 className="tasks-section-title">
            {t('tasks.agentWorking')}
            <span className="tasks-column-count">{running.length}</span>
          </h3>
          {running.map((t) => (
            <ManagedTaskCard
              key={t.id}
              task={t}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {queued.length > 0 && (
        <div className="tasks-section">
          <h3 className="tasks-section-title">
            {t('tasks.queued')}
            <span className="tasks-column-count">{queued.length}</span>
          </h3>
          {queued.map((t) => (
            <ManagedTaskCard
              key={t.id}
              task={t}
              onUpdate={onUpdate}
              onDelete={onDelete}
              compact
            />
          ))}
        </div>
      )}

      {todos.length > 0 && (
        <div className="tasks-section">
          <h3 className="tasks-section-title">
            {t('tasks.toDo')}
            <span className="tasks-column-count">{todos.length}</span>
          </h3>
          {todos.map((t) => (
            <ManagedTaskCard
              key={t.id}
              task={t}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {doneToday.length > 0 && (
        <details className="tm-done-details">
          <summary className="tasks-section-title">
            {t('tasks.doneToday')}
            <span className="tasks-column-count">{doneToday.length}</span>
          </summary>
          <div className="tm-done-list">
            {doneToday.map((t) => (
              <ManagedTaskCard
                key={t.id}
                task={t}
                onUpdate={onUpdate}
                onDelete={onDelete}
                compact
              />
            ))}
          </div>
        </details>
      )}

      <QuickAdd onAdd={onAdd} />
      <TaskRunnerStatsCard />
      <DailyBriefSettings />
    </div>
  );
}

// ── Task Runner Stats ────────────────────────────────

function TaskRunnerStatsCard() {
  const { t } = useTranslation();
  const [runnerStats, setRunnerStats] = useState<TaskRunnerStats | null>(null);

  useEffect(() => {
    getTaskRunnerStats()
      .then(setRunnerStats)
      .catch(() => {}); // 静默失败（API 可能不可用）
  }, []);

  if (!runnerStats) return null;

  const totalTokens =
    (runnerStats.tokensIn || 0) + (runnerStats.tokensOut || 0);
  const durationSec = ((runnerStats.durationMs || 0) / 1000).toFixed(1);

  return (
    <div className="tm-runner-section">
      <h3 className="tasks-section-title">{t('tasks.taskRunner')}</h3>
      <div className="tm-runner-stats">
        <div className="tm-runner-stat">
          <div className="tm-runner-stat-value">{runnerStats.traces || 0}</div>
          <div className="tm-runner-stat-label">{t('tasks.runs')}</div>
        </div>
        <div className="tm-runner-stat">
          <div className="tm-runner-stat-value">
            {runnerStats.sessions || 0}
          </div>
          <div className="tm-runner-stat-label">{t('tasks.llmCalls')}</div>
        </div>
        <div className="tm-runner-stat">
          <div className="tm-runner-stat-value">
            {totalTokens > 10000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : totalTokens.toLocaleString()}
          </div>
          <div className="tm-runner-stat-label">{t('tasks.tokens')}</div>
        </div>
        <div className="tm-runner-stat">
          <div className="tm-runner-stat-value">{durationSec}s</div>
          <div className="tm-runner-stat-label">{t('tasks.duration')}</div>
        </div>
      </div>
    </div>
  );
}

// ── Daily Brief Settings ─────────────────────────────

function DailyBriefSettings() {
  const { t } = useTranslation();
  const [time, setTime] = useState("09:00");
  const [originalTime, setOriginalTime] = useState("09:00");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        if (cfg.dailyBriefTime) {
          setTime(cfg.dailyBriefTime);
          setOriginalTime(cfg.dailyBriefTime);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  const dirty = time !== originalTime && !saved;

  const handleSave = async () => {
    try {
      await updateConfig({ dailyBriefTime: time });
      setOriginalTime(time);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="tm-runner-section">
      <h3 className="tasks-section-title">{t('tasks.dailyBrief')}</h3>
      <div className="tm-brief-settings">
        <label className="tm-brief-label">
          {t('tasks.sendTime')}
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setSaved(false);
            }}
            className="tm-brief-input"
          />
        </label>
        {(dirty || saved) && (
          <button className="tm-brief-save" onClick={handleSave} disabled={saved}>
            {saved ? t('tasks.saved') : t('common.save')}
          </button>
        )}
        <span className="tm-brief-hint">
          {t('tasks.dailyBriefHint')}
        </span>
      </div>
    </div>
  );
}

// ── All Tasks View ──────────────────────────────────

function AllTasksView({
  tasks,
  onUpdate,
  onDelete,
  onAdd,
}: {
  tasks: TaskItem[];
  onUpdate: (id: string, updates: Partial<TaskItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");

  const filtered = tasks.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    return true;
  });

  return (
    <div className="tm-all">
      <div className="tm-filters">
        <select
          className="tasks-form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{t('tasks.allStatus')}</option>
          <option value="inbox">{t('status.inbox')}</option>
          <option value="todo">{t('status.todo')}</option>
          <option value="triaged">{t('status.triaged')}</option>
          <option value="queued">{t('status.queued')}</option>
          <option value="running">{t('status.running')}</option>
          <option value="waiting_decision">{t('status.waiting_decision')}</option>
          <option value="blocked">{t('status.blocked')}</option>
          <option value="done">{t('status.done')}</option>
          <option value="failed">{t('status.failed')}</option>
        </select>
        <select
          className="tasks-form-select"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">{t('tasks.allPriority')}</option>
          <option value="urgent">{t('priority.urgent')}</option>
          <option value="high">{t('priority.high')}</option>
          <option value="normal">{t('priority.normal')}</option>
          <option value="low">{t('priority.low')}</option>
        </select>
        <span className="tm-filter-count">{t('tasks.tasksCount', { count: filtered.length })}</span>
      </div>

      <div className="tm-task-list">
        {filtered.length === 0 ? (
          <div className="tasks-empty">{t('tasks.noTasksMatch')}</div>
        ) : (
          filtered.map((t) => (
            <ManagedTaskCard
              key={t.id}
              task={t}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      <QuickAdd onAdd={onAdd} />
    </div>
  );
}

// ── Automations View ────────────────────────────────

function AutomationsView() {
  const { t } = useTranslation();
  const [automations, setAutomations] = useState<ScheduledTaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [action, setAction] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAuto = useCallback(async () => {
    try {
      const res = await listScheduledTasks();
      setAutomations(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuto();
  }, [fetchAuto]);

  const handleCreate = async () => {
    if (!name.trim() || !cron.trim() || !action.trim()) return;
    setSaving(true);
    try {
      const task = await createScheduledTask({
        name: name.trim(),
        cron: cron.trim(),
        action: action.trim(),
        enabled: true,
      });
      setAutomations((prev) => [...prev, task]);
      setShowForm(false);
      setName("");
      setCron("");
      setAction("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmDelId !== id) {
      setConfirmDelId(id);
      return;
    }
    try {
      await deleteScheduledTask(id);
      setAutomations((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setConfirmDelId(null);
    }
  };

  if (loading) return <div className="tasks-loading">{t('common.loading')}</div>;

  return (
    <div className="tm-automations">
      {error && (
        <div className="tasks-error">
          {error}
          <button onClick={() => setError(null)}>{t('common.dismiss')}</button>
        </div>
      )}

      <div className="tasks-section-header">
        <h3 className="tasks-section-title">
          {t('tasks.automations')}
          <span className="tasks-column-count">{automations.length}</span>
        </h3>
        {!showForm && (
          <button
            className="btn-secondary"
            onClick={() => setShowForm(true)}
            style={{ marginLeft: "auto", padding: "4px 12px", fontSize: 13 }}
          >
            {t('tasks.addAutomation')}
          </button>
        )}
      </div>

      {showForm && (
        <div className="auto-form">
          <input
            type="text"
            className="tasks-form-input"
            placeholder={t('tasks.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            className="tasks-form-input"
            placeholder={t('tasks.cronPlaceholder')}
            value={cron}
            onChange={(e) => setCron(e.target.value)}
          />
          <input
            type="text"
            className="tasks-form-input"
            placeholder={t('tasks.actionPlaceholder')}
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
          <div className="tasks-form-actions">
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={
                saving || !name.trim() || !cron.trim() || !action.trim()
              }
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowForm(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {automations.length === 0 && !showForm ? (
        <div className="tasks-empty">
          {t('tasks.noAutomations')}
        </div>
      ) : (
        <div className="auto-list">
          {automations.map((auto) => (
            <div key={auto.id} className="auto-item">
              <div className="auto-item-header">
                <div className="auto-item-left">
                  <div
                    className={`auto-toggle ${auto.enabled ? "enabled" : ""}`}
                    title={auto.enabled ? t('tasks.enabled') : t('tasks.disabled')}
                  >
                    <div className="auto-toggle-knob" />
                  </div>
                  <span className="auto-name">{auto.name}</span>
                </div>
                <div className="auto-item-actions">
                  {confirmDelId === auto.id ? (
                    <span className="auto-confirm-delete">
                      <span className="auto-confirm-text">{t('tasks.deleteConfirm')}</span>
                      <button
                        className="btn-danger tasks-card-btn"
                        onClick={() => handleDelete(auto.id)}
                      >
                        {t('common.yes')}
                      </button>
                      <button
                        className="btn-secondary tasks-card-btn"
                        onClick={() => setConfirmDelId(null)}
                      >
                        {t('common.no')}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-secondary tasks-card-btn"
                      onClick={() => handleDelete(auto.id)}
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </div>
              </div>
              <div className="auto-item-details">
                <span>
                  <span className="auto-detail-label">{t('tasks.cron')}</span>{" "}
                  <code>{auto.cron}</code>
                </span>
                <span>
                  <span className="auto-detail-label">{t('tasks.action')}</span>{" "}
                  {auto.action}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Calendar View ──────────────────────────────────

function CalendarView({ tasks }: { tasks: TaskItem[] }) {
  const { t } = useTranslation();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() === month;

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  // Group tasks by day of month using dueDate, deadline, or createdAt
  const tasksByDay = new Map<number, TaskItem[]>();
  for (const task of tasks) {
    const dateStr = task.dueDate || task.deadline || task.createdAt;
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!tasksByDay.has(day)) tasksByDay.set(day, []);
      tasksByDay.get(day)!.push(task);
    }
  }

  const getDotClass = (status: string): string => {
    if (status === "done") return "done";
    if (status === "running") return "running";
    if (status === "waiting_decision") return "waiting";
    return "todo";
  };

  const monthName = currentDate.toLocaleString("default", { month: "long" });
  const dayNames = [t('dayNames.sun'), t('dayNames.mon'), t('dayNames.tue'), t('dayNames.wed'), t('dayNames.thu'), t('dayNames.fri'), t('dayNames.sat')];

  const selectedTasks = selectedDay ? tasksByDay.get(selectedDay) || [] : [];

  return (
    <div className="tm-calendar">
      <div className="tm-cal-header">
        <button className="btn-secondary" onClick={prevMonth}>
          &larr;
        </button>
        <h3 className="tm-cal-month-title">
          {monthName} {year}
        </h3>
        <button className="btn-secondary" onClick={nextMonth}>
          &rarr;
        </button>
      </div>

      <div className="tm-cal-grid">
        {dayNames.map((name) => (
          <div key={name} className="tm-cal-day-name">
            {name}
          </div>
        ))}

        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} className="tm-cal-day tm-cal-day-empty" />
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayTasks = tasksByDay.get(day) || [];
          const isToday = isCurrentMonth && today.getDate() === day;
          const isSelected = selectedDay === day;

          return (
            <div
              key={day}
              className={`tm-cal-day${isToday ? " today" : ""}${isSelected ? " selected" : ""}`}
              onClick={() => setSelectedDay(isSelected ? null : day)}
            >
              <span className="tm-cal-day-num">{day}</span>
              {dayTasks.length > 0 && (
                <div className="tm-cal-dots">
                  {dayTasks.slice(0, 5).map((t, j) => (
                    <span
                      key={j}
                      className={`tm-cal-dot ${getDotClass(t.status)}`}
                    />
                  ))}
                  {dayTasks.length > 5 && (
                    <span className="tm-cal-dot-more">
                      +{dayTasks.length - 5}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedDay !== null && (
        <div className="tm-cal-selected-day">
          <h4 className="tasks-section-title">
            {monthName} {selectedDay}
            <span className="tasks-column-count">{selectedTasks.length}</span>
          </h4>
          {selectedTasks.length === 0 ? (
            <div className="tasks-empty">{t('tasks.noTasksOnDay')}</div>
          ) : (
            selectedTasks.map((task) => (
              <div key={task.id} className="tm-cal-task-item">
                <span
                  className={`tm-cal-dot ${getDotClass(task.status)}`}
                  style={{ flexShrink: 0 }}
                />
                <span className="tm-cal-task-title">{task.title}</span>
                <span className="tm-status-badge">
                  {t(`status.${task.status}`, task.status)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Decision Queue View ────────────────────────────

function DecisionQueueView({
  tasks,
  onDecide,
}: {
  tasks: TaskItem[];
  onDecide: (id: string, decision: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const decisions = tasks.filter((t) => t.status === "waiting_decision");

  if (decisions.length === 0) {
    return (
      <div className="tm-decisions">
        <div className="tm-decisions-empty">
          <div className="tm-decisions-empty-icon">&#10003;</div>
          <h3>{t('tasks.noPendingDecisions')}</h3>
          <p>
            {t('tasks.allCaughtUp')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tm-decisions">
      <div className="tm-decisions-header">
        <h3 className="tasks-section-title">
          {t('tasks.decisionQueue')}
          <span className="tasks-column-count">{decisions.length}</span>
        </h3>
      </div>
      <div className="tm-decision-list">
        {decisions.map((task) => (
          <DecisionCard key={task.id} task={task} onDecide={onDecide} />
        ))}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────

type TabId = "today" | "all" | "calendar" | "decisions" | "automations";

export function TasksPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("today");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listManagedTasks({ limit: 200 });
      setTasks(res.items);
      setStats(res.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh every 30s for running tasks
  useEffect(() => {
    const hasActive = tasks.some(
      (t) => t.status === "running" || t.status === "queued",
    );
    if (!hasActive) return;
    const timer = setInterval(fetchTasks, 30_000);
    return () => clearInterval(timer);
  }, [tasks, fetchTasks]);

  const handleUpdate = async (id: string, updates: Partial<TaskItem>) => {
    try {
      await updateManagedTask(id, updates);
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteManagedTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleDecide = async (id: string, decision: string) => {
    try {
      await submitDecision(id, decision);
      await fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    }
  };

  const handleAdd = async (text: string) => {
    try {
      const created = await createManagedTask({ task: { title: text } });
      setTasks((prev) => [created, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  if (loading && tasks.length === 0) {
    return (
      <>
        <PageHeader>{t('tasks.title')}</PageHeader>
        <div className="page-body">
          <div className="tasks-loading">{t('tasks.loadingTasks')}</div>
        </div>
      </>
    );
  }

  const decisionCount = tasks.filter(
    (t) => t.status === "waiting_decision",
  ).length;

  return (
    <>
      <PageHeader>{t('tasks.title')}</PageHeader>
      <div className="page-body">
        {error && (
          <div className="tasks-error">
            {error}
            <button onClick={() => setError(null)}>{t('common.dismiss')}</button>
          </div>
        )}

        <div className="tm-tabs">
          <button
            className={`tm-tab ${tab === "today" ? "active" : ""}`}
            onClick={() => setTab("today")}
          >
            {t('tasks.today')}
          </button>
          <button
            className={`tm-tab ${tab === "all" ? "active" : ""}`}
            onClick={() => setTab("all")}
          >
            {t('tasks.allTasks')}
          </button>
          <button
            className={`tm-tab ${tab === "calendar" ? "active" : ""}`}
            onClick={() => setTab("calendar")}
          >
            {t('tasks.calendar')}
          </button>
          <button
            className={`tm-tab ${tab === "decisions" ? "active" : ""}`}
            onClick={() => setTab("decisions")}
          >
            {t('tasks.decisions')}
            {decisionCount > 0 && (
              <span className="tm-tab-badge">{decisionCount}</span>
            )}
          </button>
          <button
            className={`tm-tab ${tab === "automations" ? "active" : ""}`}
            onClick={() => setTab("automations")}
          >
            {t('tasks.automations')}
          </button>
          <button
            className="btn-secondary tm-refresh-btn"
            onClick={fetchTasks}
            disabled={loading}
          >
            {loading ? "..." : t('common.refresh')}
          </button>
        </div>

        {tab === "today" && (
          <TodayView
            tasks={tasks}
            stats={stats}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onDecide={handleDecide}
            onAdd={handleAdd}
          />
        )}

        {tab === "all" && (
          <AllTasksView
            tasks={tasks}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        )}

        {tab === "calendar" && <CalendarView tasks={tasks} />}

        {tab === "decisions" && (
          <DecisionQueueView tasks={tasks} onDecide={handleDecide} />
        )}

        {tab === "automations" && <AutomationsView />}
      </div>
    </>
  );
}

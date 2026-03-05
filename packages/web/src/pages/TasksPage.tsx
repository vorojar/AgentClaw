import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  listTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  getCalendar,
  listScheduledTasks,
  createScheduledTask,
  deleteScheduledTask,
  type TodoInfo,
  type CalendarItem,
  type ScheduledTaskInfo,
} from "../api/client";
import "./TasksPage.css";

type ViewMode = "kanban" | "calendar";
type TodoStatus = "todo" | "in_progress" | "done";

const STATUS_COLUMNS: { key: TodoStatus; label: string }[] = [
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

const PRIORITY_OPTIONS: TodoInfo["priority"][] = ["low", "medium", "high"];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(iso: string | undefined): string {
  if (!iso) return "\u2014";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

function getMonthDays(year: number, month: number): Date[] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const startDay = first.getDay();
  const days: Date[] = [];

  // Fill leading blanks from previous month
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, -i);
    days.push(d);
  }

  // Current month days
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month - 1, d));
  }

  // Fill trailing to complete the last week
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      days.push(new Date(year, month, i));
    }
  }

  return days;
}

function monthName(month: number): string {
  return new Date(2024, month - 1, 1).toLocaleString("default", {
    month: "long",
  });
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Inline Task Form ────────────────────────────────

interface TaskFormProps {
  onSave: (data: {
    title: string;
    description: string;
    priority: TodoInfo["priority"];
    dueDate: string;
    assignee: string;
    status?: TodoStatus;
  }) => Promise<void>;
  onCancel: () => void;
  initial?: Partial<TodoInfo>;
  showStatus?: boolean;
  saving: boolean;
}

function TaskForm({
  onSave,
  onCancel,
  initial,
  showStatus,
  saving,
}: TaskFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState<TodoInfo["priority"]>(
    initial?.priority ?? "medium",
  );
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [assignee, setAssignee] = useState(initial?.assignee ?? "human");
  const [status, setStatus] = useState<TodoStatus>(initial?.status ?? "todo");

  const handleSubmit = () => {
    if (!title.trim()) return;
    const data: {
      title: string;
      description: string;
      priority: TodoInfo["priority"];
      dueDate: string;
      assignee: string;
      status?: TodoStatus;
    } = {
      title: title.trim(),
      description: description.trim(),
      priority,
      dueDate,
      assignee,
    };
    if (showStatus) data.status = status;
    onSave(data);
  };

  return (
    <div className="tasks-inline-form">
      <input
        type="text"
        className="tasks-form-input"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        autoFocus
      />
      <textarea
        className="tasks-form-textarea"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <div className="tasks-form-row">
        <select
          className="tasks-form-select"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TodoInfo["priority"])}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        <select
          className="tasks-form-select"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="human">Human</option>
          <option value="bot">Bot</option>
        </select>
        <input
          type="date"
          className="tasks-form-date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        {showStatus && (
          <select
            className="tasks-form-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as TodoStatus)}
          >
            {STATUS_COLUMNS.map((col) => (
              <option key={col.key} value={col.key}>
                {col.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="tasks-form-actions">
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={saving || !title.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Task Card ───────────────────────────────────────

interface TaskCardProps {
  todo: TodoInfo;
  onUpdate: (id: string, updates: Partial<TodoInfo>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function TaskCard({ todo, onUpdate, onDelete }: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async (data: {
    title: string;
    description: string;
    priority: TodoInfo["priority"];
    dueDate: string;
    assignee: string;
    status?: TodoStatus;
  }) => {
    setSaving(true);
    try {
      await onUpdate(todo.id, data);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await onDelete(todo.id);
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  if (editing) {
    return (
      <div className="tasks-card tasks-card-editing">
        <TaskForm
          initial={todo}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
          showStatus
          saving={saving}
        />
      </div>
    );
  }

  return (
    <div className="tasks-card" onClick={() => setEditing(true)}>
      <div className="tasks-card-title">{todo.title}</div>
      {todo.description && (
        <div className="tasks-card-desc">{todo.description}</div>
      )}
      <div className="tasks-card-footer">
        <span className={`tasks-priority tasks-priority-${todo.priority}`}>
          {todo.priority}
        </span>
        {todo.dueDate && (
          <span className="tasks-card-due">{formatDate(todo.dueDate)}</span>
        )}
        <span
          className={`tasks-assignee tasks-assignee-${todo.assignee ?? "human"}`}
          title={`Assignee: ${todo.assignee ?? "human"}`}
        >
          {(todo.assignee ?? "human") === "bot" ? "Bot" : "Human"}
        </span>
        <div className="tasks-card-spacer" />
        {confirmDelete ? (
          <span
            className="tasks-card-delete-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="btn-danger tasks-card-btn"
              onClick={handleDelete}
              disabled={saving}
            >
              {saving ? "..." : "Yes"}
            </button>
            <button
              className="btn-secondary tasks-card-btn"
              onClick={() => setConfirmDelete(false)}
            >
              No
            </button>
          </span>
        ) : (
          <button
            className="tasks-card-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            title="Delete"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────

export function TasksPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [todos, setTodos] = useState<TodoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add task form visibility
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);

  // Calendar state
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [calItems, setCalItems] = useState<CalendarItem[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Scheduled tasks
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskInfo[]>([]);
  const [showSchedForm, setShowSchedForm] = useState(false);
  const [newSchedName, setNewSchedName] = useState("");
  const [newSchedCron, setNewSchedCron] = useState("");
  const [newSchedAction, setNewSchedAction] = useState("");
  const [newSchedEnabled, setNewSchedEnabled] = useState(true);
  const [schedCreating, setSchedCreating] = useState(false);
  const [confirmDeleteSchedId, setConfirmDeleteSchedId] = useState<
    string | null
  >(null);
  const [deletingSchedId, setDeletingSchedId] = useState<string | null>(null);

  // ── Data fetching ──────────────────────────────────

  const fetchTodos = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listTodos();
      setTodos(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCalendar = useCallback(async (y: number, m: number) => {
    try {
      setCalLoading(true);
      const [calData, schedData] = await Promise.all([
        getCalendar(y, m),
        listScheduledTasks(),
      ]);
      setCalItems(calData.items);
      setScheduledTasks(schedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  useEffect(() => {
    if (viewMode === "calendar") {
      fetchCalendar(calYear, calMonth);
    }
  }, [viewMode, calYear, calMonth, fetchCalendar]);

  // ── Handlers ───────────────────────────────────────

  const handleAddTodo = async (data: {
    title: string;
    description: string;
    priority: TodoInfo["priority"];
    dueDate: string;
    assignee: string;
  }) => {
    setAddingSaving(true);
    try {
      const newTodo = await createTodo({
        title: data.title,
        description: data.description || undefined,
        priority: data.priority,
        dueDate: data.dueDate || undefined,
        assignee: data.assignee,
      });
      setTodos((prev) => [...prev, newTodo]);
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setAddingSaving(false);
    }
  };

  const handleUpdateTodo = async (id: string, updates: Partial<TodoInfo>) => {
    try {
      await updateTodo(id, updates);
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    }
  };

  const handleDeleteTodo = async (id: string) => {
    try {
      await deleteTodo(id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  const handlePrevMonth = () => {
    if (calMonth === 1) {
      setCalYear((y) => y - 1);
      setCalMonth(12);
    } else {
      setCalMonth((m) => m - 1);
    }
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    if (calMonth === 12) {
      setCalYear((y) => y + 1);
      setCalMonth(1);
    } else {
      setCalMonth((m) => m + 1);
    }
    setSelectedDate(null);
  };

  const handleCreateScheduledTask = async () => {
    if (!newSchedName.trim() || !newSchedCron.trim() || !newSchedAction.trim())
      return;
    try {
      setSchedCreating(true);
      const task = await createScheduledTask({
        name: newSchedName.trim(),
        cron: newSchedCron.trim(),
        action: newSchedAction.trim(),
        enabled: newSchedEnabled,
      });
      setScheduledTasks((prev) => [...prev, task]);
      setNewSchedName("");
      setNewSchedCron("");
      setNewSchedAction("");
      setNewSchedEnabled(true);
      setShowSchedForm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create scheduled task",
      );
    } finally {
      setSchedCreating(false);
    }
  };

  const handleDeleteScheduledTask = async (id: string) => {
    if (confirmDeleteSchedId !== id) {
      setConfirmDeleteSchedId(id);
      return;
    }
    try {
      setDeletingSchedId(id);
      await deleteScheduledTask(id);
      setScheduledTasks((prev) => prev.filter((t) => t.id !== id));
      setConfirmDeleteSchedId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete scheduled task",
      );
    } finally {
      setDeletingSchedId(null);
    }
  };

  // ── Derived data ───────────────────────────────────

  const todosByStatus: Record<TodoStatus, TodoInfo[]> = {
    todo: [],
    in_progress: [],
    done: [],
  };
  for (const t of todos) {
    if (todosByStatus[t.status]) {
      todosByStatus[t.status].push(t);
    }
  }

  const calDays = getMonthDays(calYear, calMonth);
  const calItemsByDate: Record<string, CalendarItem[]> = {};
  for (const item of calItems) {
    const dk = item.date;
    if (!calItemsByDate[dk]) calItemsByDate[dk] = [];
    calItemsByDate[dk].push(item);
  }

  const selectedDateItems = selectedDate
    ? (calItemsByDate[selectedDate] ?? [])
    : [];

  // ── Render ─────────────────────────────────────────

  if (loading && todos.length === 0) {
    return (
      <>
        <PageHeader>Tasks</PageHeader>
        <div className="page-body">
          <div className="tasks-loading">Loading tasks...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>Tasks</PageHeader>
      <div className="page-body">
        {error && (
          <div className="tasks-error">
            {error}
            <button onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="tasks-toolbar">
          <span className="tasks-total">
            {todos.length} {todos.length === 1 ? "task" : "tasks"}
          </span>
          <div className="tasks-view-toggle">
            <button
              className={`btn-secondary tasks-view-btn ${viewMode === "kanban" ? "active" : ""}`}
              onClick={() => setViewMode("kanban")}
            >
              Kanban
            </button>
            <button
              className={`btn-secondary tasks-view-btn ${viewMode === "calendar" ? "active" : ""}`}
              onClick={() => setViewMode("calendar")}
            >
              Calendar
            </button>
          </div>
        </div>

        {/* ── Kanban View ──────────────────────────────── */}
        {viewMode === "kanban" && (
          <div className="tasks-kanban">
            {STATUS_COLUMNS.map((col) => (
              <div className="tasks-column" key={col.key}>
                <div className="tasks-column-header">
                  <span className="tasks-column-title">{col.label}</span>
                  <span className="tasks-column-count">
                    {todosByStatus[col.key].length}
                  </span>
                </div>
                <div className="tasks-column-body">
                  {todosByStatus[col.key].map((todo) => (
                    <TaskCard
                      key={todo.id}
                      todo={todo}
                      onUpdate={handleUpdateTodo}
                      onDelete={handleDeleteTodo}
                    />
                  ))}

                  {col.key === "todo" && !showAddForm && (
                    <button
                      className="tasks-add-btn"
                      onClick={() => setShowAddForm(true)}
                    >
                      + Add Task
                    </button>
                  )}
                  {col.key === "todo" && showAddForm && (
                    <TaskForm
                      onSave={handleAddTodo}
                      onCancel={() => setShowAddForm(false)}
                      saving={addingSaving}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Calendar View ────────────────────────────── */}
        {viewMode === "calendar" && (
          <>
            <div className="tasks-calendar-section">
              <div className="tasks-cal-nav">
                <button
                  className="btn-secondary tasks-cal-nav-btn"
                  onClick={handlePrevMonth}
                >
                  &larr;
                </button>
                <span className="tasks-cal-title">
                  {monthName(calMonth)} {calYear}
                </span>
                <button
                  className="btn-secondary tasks-cal-nav-btn"
                  onClick={handleNextMonth}
                >
                  &rarr;
                </button>
              </div>

              {calLoading ? (
                <div className="tasks-loading">Loading calendar...</div>
              ) : (
                <div className="tasks-cal-grid">
                  {WEEKDAYS.map((wd) => (
                    <div className="tasks-cal-weekday" key={wd}>
                      {wd}
                    </div>
                  ))}
                  {calDays.map((day, i) => {
                    const dk = dateKey(day);
                    const isCurrentMonth = day.getMonth() + 1 === calMonth;
                    const items = calItemsByDate[dk] ?? [];
                    const taskDots = items.filter(
                      (it) => it.type === "task",
                    ).length;
                    const schedDots = items.filter(
                      (it) => it.type === "schedule",
                    ).length;
                    const isSelected = selectedDate === dk;
                    const isToday = dk === dateKey(new Date());

                    return (
                      <div
                        key={i}
                        className={`tasks-cal-cell${isCurrentMonth ? "" : " tasks-cal-cell-outside"}${isSelected ? " tasks-cal-cell-selected" : ""}${isToday ? " tasks-cal-cell-today" : ""}`}
                        onClick={() => setSelectedDate(isSelected ? null : dk)}
                      >
                        <span className="tasks-cal-day">{day.getDate()}</span>
                        {(taskDots > 0 || schedDots > 0) && (
                          <div className="tasks-cal-dots">
                            {Array.from({ length: Math.min(taskDots, 3) }).map(
                              (_, j) => (
                                <span
                                  key={`t${j}`}
                                  className="tasks-cal-dot tasks-cal-dot-task"
                                />
                              ),
                            )}
                            {Array.from({
                              length: Math.min(schedDots, 3),
                            }).map((_, j) => (
                              <span
                                key={`s${j}`}
                                className="tasks-cal-dot tasks-cal-dot-sched"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Selected date panel */}
              {selectedDate && (
                <div className="tasks-cal-detail">
                  <div className="tasks-cal-detail-title">
                    {new Date(selectedDate + "T00:00:00").toLocaleDateString(
                      "default",
                      {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      },
                    )}
                  </div>
                  {selectedDateItems.length === 0 ? (
                    <div className="tasks-cal-detail-empty">
                      No items on this date
                    </div>
                  ) : (
                    <div className="tasks-cal-detail-list">
                      {selectedDateItems.map((item) => (
                        <div key={item.id} className="tasks-cal-detail-item">
                          <span
                            className={`tasks-cal-detail-type ${item.type === "task" ? "tasks-cal-detail-type-task" : "tasks-cal-detail-type-sched"}`}
                          >
                            {item.type === "task" ? "Task" : "Scheduled"}
                          </span>
                          <span className="tasks-cal-detail-name">
                            {item.title}
                          </span>
                          {item.status && (
                            <span className="badge badge-info">
                              {item.status}
                            </span>
                          )}
                          {item.priority && (
                            <span
                              className={`tasks-priority tasks-priority-${item.priority}`}
                            >
                              {item.priority}
                            </span>
                          )}
                          {item.cron && (
                            <code className="tasks-cal-detail-cron">
                              {item.cron}
                            </code>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Scheduled Tasks Section ──────────────── */}
            <section className="card tasks-sched-section">
              <h2 className="tasks-sched-title">
                Scheduled Tasks
                <span className="tasks-sched-count">
                  {scheduledTasks.length}
                </span>
                <button
                  className="btn-primary tasks-sched-add-btn"
                  onClick={() => setShowSchedForm((v) => !v)}
                >
                  {showSchedForm ? "Cancel" : "Add Task"}
                </button>
              </h2>

              {showSchedForm && (
                <div className="tasks-sched-form">
                  <div className="tasks-sched-field">
                    <label className="tasks-sched-label">Name</label>
                    <input
                      type="text"
                      value={newSchedName}
                      onChange={(e) => setNewSchedName(e.target.value)}
                      placeholder="Task name"
                    />
                  </div>
                  <div className="tasks-sched-field">
                    <label className="tasks-sched-label">Cron Expression</label>
                    <input
                      type="text"
                      value={newSchedCron}
                      onChange={(e) => setNewSchedCron(e.target.value)}
                      placeholder="e.g. 0 */6 * * *"
                    />
                  </div>
                  <div className="tasks-sched-field">
                    <label className="tasks-sched-label">Action</label>
                    <input
                      type="text"
                      value={newSchedAction}
                      onChange={(e) => setNewSchedAction(e.target.value)}
                      placeholder="Action to execute"
                    />
                  </div>
                  <div className="tasks-sched-field tasks-sched-field-inline">
                    <label className="tasks-sched-label">Enabled</label>
                    <span
                      className={`tasks-sched-toggle ${newSchedEnabled ? "enabled" : "disabled"}`}
                      onClick={() => setNewSchedEnabled((v) => !v)}
                    >
                      <span className="tasks-sched-toggle-knob" />
                    </span>
                  </div>
                  <div className="tasks-sched-form-actions">
                    <button
                      className="btn-primary"
                      onClick={handleCreateScheduledTask}
                      disabled={
                        schedCreating ||
                        !newSchedName.trim() ||
                        !newSchedCron.trim() ||
                        !newSchedAction.trim()
                      }
                    >
                      {schedCreating ? "Creating..." : "Create Task"}
                    </button>
                  </div>
                </div>
              )}

              {scheduledTasks.length === 0 && !showSchedForm ? (
                <div className="tasks-sched-empty">No scheduled tasks</div>
              ) : (
                <div className="tasks-sched-list">
                  {scheduledTasks.map((task) => (
                    <div key={task.id} className="tasks-sched-item">
                      <div className="tasks-sched-item-header">
                        <div className="tasks-sched-item-left">
                          <span className="tasks-sched-name">{task.name}</span>
                          <span
                            className={`badge ${task.enabled ? "badge-success" : "badge-muted"}`}
                          >
                            {task.enabled ? "enabled" : "disabled"}
                          </span>
                        </div>
                        <div className="tasks-sched-item-actions">
                          {confirmDeleteSchedId === task.id ? (
                            <span className="tasks-sched-confirm-delete">
                              <span className="tasks-sched-confirm-text">
                                Delete?
                              </span>
                              <button
                                className="btn-danger tasks-sched-action-btn"
                                onClick={() =>
                                  handleDeleteScheduledTask(task.id)
                                }
                                disabled={deletingSchedId === task.id}
                              >
                                {deletingSchedId === task.id ? "..." : "Yes"}
                              </button>
                              <button
                                className="btn-secondary tasks-sched-action-btn"
                                onClick={() => setConfirmDeleteSchedId(null)}
                              >
                                No
                              </button>
                            </span>
                          ) : (
                            <button
                              className="btn-secondary tasks-sched-action-btn"
                              onClick={() => handleDeleteScheduledTask(task.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="tasks-sched-item-details">
                        <span>
                          <span className="tasks-sched-detail-label">
                            Cron:
                          </span>{" "}
                          <code>{task.cron}</code>
                        </span>
                        <span>
                          <span className="tasks-sched-detail-label">
                            Action:
                          </span>{" "}
                          {task.action}
                        </span>
                        <span>
                          <span className="tasks-sched-detail-label">
                            Last Run:
                          </span>{" "}
                          {formatTime(task.lastRunAt)}
                        </span>
                        <span>
                          <span className="tasks-sched-detail-label">
                            Next Run:
                          </span>{" "}
                          {formatTime(task.nextRunAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

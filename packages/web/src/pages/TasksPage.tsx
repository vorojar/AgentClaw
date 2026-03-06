import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  listGoogleTasks,
  createGoogleTask,
  updateGoogleTask,
  deleteGoogleTask,
  listGoogleCalendarEvents,
  type GoogleTask,
  type GoogleCalendarEvent,
} from "../api/client";
import "./TasksPage.css";

// ── Helpers ──────────────────────────────────────────

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatEventDate(iso: string, allDay: boolean): string {
  if (allDay) return formatDate(iso);
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return iso;
  }
}

// ── Add Task Form ────────────────────────────────────

interface AddTaskFormProps {
  onSave: (title: string, notes: string, due: string) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function AddTaskForm({ onSave, onCancel, saving }: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave(title.trim(), notes.trim(), due);
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
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
      />
      <div className="tasks-form-row">
        <input
          type="date"
          className="tasks-form-date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
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

// ── Task Card ────────────────────────────────────────

interface TaskCardProps {
  task: GoogleTask;
  onComplete: (id: string) => Promise<void>;
  onReopen: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function TaskCard({ task, onComplete, onReopen, onDelete }: TaskCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCompleted = task.status === "completed";

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (isCompleted) {
        await onReopen(task.id);
      } else {
        await onComplete(task.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await onDelete(task.id);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className={`tasks-card ${isCompleted ? "tasks-card-completed" : ""}`}>
      <div className="tasks-card-header">
        <button
          className={`tasks-check-btn ${isCompleted ? "checked" : ""}`}
          onClick={handleToggle}
          disabled={busy}
          title={isCompleted ? "Reopen" : "Complete"}
        >
          {isCompleted ? "✓" : "○"}
        </button>
        <span
          className={`tasks-card-title ${isCompleted ? "tasks-title-done" : ""}`}
        >
          {task.title}
        </span>
      </div>
      {task.notes && <div className="tasks-card-desc">{task.notes}</div>}
      <div className="tasks-card-footer">
        {task.due && (
          <span className="tasks-card-due">{formatDate(task.due)}</span>
        )}
        <div className="tasks-card-spacer" />
        {confirmDelete ? (
          <span
            className="tasks-card-delete-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="btn-danger tasks-card-btn"
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? "..." : "Yes"}
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

// ── Calendar Event Card ──────────────────────────────

function EventCard({ event }: { event: GoogleCalendarEvent }) {
  return (
    <div className="tasks-event-card">
      <div className="tasks-event-time">
        {event.allDay
          ? "All day"
          : `${formatTime(event.start)} – ${formatTime(event.end)}`}
      </div>
      <div className="tasks-event-summary">{event.summary}</div>
      {event.location && (
        <div className="tasks-event-location">{event.location}</div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────

export function TasksPage() {
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);

  // ── Data fetching ──────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [tasksRes, eventsRes] = await Promise.all([
        listGoogleTasks("@default", showCompleted),
        listGoogleCalendarEvents(14),
      ]);
      setTasks(tasksRes.items);
      setEvents(eventsRes.items);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load Google data",
      );
    } finally {
      setLoading(false);
    }
  }, [showCompleted]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Handlers ───────────────────────────────────────

  const handleAddTask = async (title: string, notes: string, due: string) => {
    setAddingSaving(true);
    try {
      const dueISO = due ? `${due}T00:00:00Z` : undefined;
      const newTask = await createGoogleTask({
        title,
        notes: notes || undefined,
        due: dueISO,
      });
      setTasks((prev) => [...prev, newTask]);
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setAddingSaving(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await updateGoogleTask(id, { status: "completed" });
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "completed" } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete task");
    }
  };

  const handleReopen = async (id: string) => {
    try {
      await updateGoogleTask(id, { status: "needsAction" });
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "needsAction" } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen task");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGoogleTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  // ── Derived data ───────────────────────────────────

  const activeTasks = tasks.filter((t) => t.status === "needsAction");
  const completedTasks = tasks.filter((t) => t.status === "completed");

  // Group events by date
  const eventsByDate: Record<string, GoogleCalendarEvent[]> = {};
  for (const ev of events) {
    const dateKey = ev.start.slice(0, 10);
    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(ev);
  }
  const sortedEventDates = Object.keys(eventsByDate).sort();

  // ── Render ─────────────────────────────────────────

  if (loading && tasks.length === 0) {
    return (
      <>
        <PageHeader>Tasks</PageHeader>
        <div className="page-body">
          <div className="tasks-loading">Loading Google Tasks & Calendar...</div>
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

        {/* ── Google Tasks Section ──────────────────────── */}
        <div className="tasks-section">
          <div className="tasks-section-header">
            <h2 className="tasks-section-title">
              Google Tasks
              <span className="tasks-column-count">{activeTasks.length}</span>
            </h2>
            <label className="tasks-show-completed">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
              />
              Show completed
            </label>
            <button
              className="btn-primary"
              onClick={() => fetchData()}
              disabled={loading}
              style={{ marginLeft: "auto", padding: "4px 12px", fontSize: 13 }}
            >
              {loading ? "..." : "Refresh"}
            </button>
          </div>

          <div className="tasks-kanban">
            {/* Active column */}
            <div className="tasks-column">
              <div className="tasks-column-header">
                <span className="tasks-column-title">To Do</span>
                <span className="tasks-column-count">
                  {activeTasks.length}
                </span>
              </div>
              <div className="tasks-column-body">
                {activeTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onComplete={handleComplete}
                    onReopen={handleReopen}
                    onDelete={handleDelete}
                  />
                ))}
                {!showAddForm && (
                  <button
                    className="tasks-add-btn"
                    onClick={() => setShowAddForm(true)}
                  >
                    + Add Task
                  </button>
                )}
                {showAddForm && (
                  <AddTaskForm
                    onSave={handleAddTask}
                    onCancel={() => setShowAddForm(false)}
                    saving={addingSaving}
                  />
                )}
              </div>
            </div>

            {/* Completed column */}
            {showCompleted && (
              <div className="tasks-column">
                <div className="tasks-column-header">
                  <span className="tasks-column-title">Completed</span>
                  <span className="tasks-column-count">
                    {completedTasks.length}
                  </span>
                </div>
                <div className="tasks-column-body">
                  {completedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onComplete={handleComplete}
                      onReopen={handleReopen}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Google Calendar Section ───────────────────── */}
        <div className="tasks-section" style={{ marginTop: 32 }}>
          <div className="tasks-section-header">
            <h2 className="tasks-section-title">
              Upcoming Events
              <span className="tasks-column-count">{events.length}</span>
            </h2>
          </div>

          {events.length === 0 ? (
            <div className="tasks-empty">No upcoming events in the next 14 days.</div>
          ) : (
            <div className="tasks-events-list">
              {sortedEventDates.map((dateKey) => (
                <div key={dateKey} className="tasks-events-day">
                  <div className="tasks-events-day-header">
                    {formatEventDate(dateKey, true)}
                    <span className="tasks-events-day-name">
                      {new Date(dateKey + "T00:00:00").toLocaleDateString(
                        undefined,
                        { weekday: "long" },
                      )}
                    </span>
                  </div>
                  {eventsByDate[dateKey].map((ev) => (
                    <EventCard key={ev.id} event={ev} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

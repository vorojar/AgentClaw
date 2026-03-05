import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  listTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  type TodoInfo,
} from "../api/client";
import "./TasksPage.css";

type TodoStatus = "todo" | "in_progress" | "done";

const STATUS_COLUMNS: { key: TodoStatus; label: string }[] = [
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

const PRIORITY_OPTIONS: TodoInfo["priority"][] = ["low", "medium", "high"];

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return iso;
  }
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
  const [todos, setTodos] = useState<TodoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add task form visibility
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);

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

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

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
        </div>

        {/* ── Kanban View ──────────────────────────────── */}
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
      </div>
    </>
  );
}

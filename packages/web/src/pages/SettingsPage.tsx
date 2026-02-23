import { useState, useEffect, useCallback } from "react";
import {
  getConfig,
  getStats,
  listTools,
  listScheduledTasks,
  createScheduledTask,
  deleteScheduledTask,
  type AppConfigInfo,
  type UsageStatsInfo,
  type ToolInfo,
  type ScheduledTaskInfo,
} from "../api/client";
import { IconChevronDown } from "../components/Icons";
import "./SettingsPage.css";

function formatTime(iso: string | undefined): string {
  if (!iso) return "\u2014";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [stats, setStats] = useState<UsageStatsInfo | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [tasks, setTasks] = useState<ScheduledTaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tools collapse
  const [toolsExpanded, setToolsExpanded] = useState(false);

  // New task form
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskCron, setNewTaskCron] = useState("");
  const [newTaskAction, setNewTaskAction] = useState("");
  const [newTaskEnabled, setNewTaskEnabled] = useState(true);
  const [taskCreating, setTaskCreating] = useState(false);

  // Deleting tasks
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(
    null,
  );
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [configData, statsData, toolsData, tasksData] = await Promise.all([
        getConfig(),
        getStats(),
        listTools(),
        listScheduledTasks(),
      ]);
      setConfig(configData);
      setStats(statsData);
      setTools(toolsData);
      setTasks(tasksData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleCreateTask = async () => {
    if (!newTaskName.trim() || !newTaskCron.trim() || !newTaskAction.trim()) {
      return;
    }
    try {
      setTaskCreating(true);
      const task = await createScheduledTask({
        name: newTaskName.trim(),
        cron: newTaskCron.trim(),
        action: newTaskAction.trim(),
        enabled: newTaskEnabled,
      });
      setTasks((prev) => [...prev, task]);
      setNewTaskName("");
      setNewTaskCron("");
      setNewTaskAction("");
      setNewTaskEnabled(true);
      setShowTaskForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setTaskCreating(false);
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (confirmDeleteTaskId !== id) {
      setConfirmDeleteTaskId(id);
      return;
    }
    try {
      setDeletingTaskId(id);
      await deleteScheduledTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setConfirmDeleteTaskId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task");
    } finally {
      setDeletingTaskId(null);
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header">Settings</div>
        <div className="page-body">
          <div className="settings-loading">Loading settings...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">Settings</div>
      <div className="page-body">
        {error && <div className="settings-error">{error}</div>}

        {/* Usage Statistics + System Info */}
        {stats && (
          <section className="card settings-section">
            <h2 className="settings-section-title">Usage Statistics</h2>
            <div className="stats-overview">
              <div className="stat-item">
                <span className="stat-value">
                  {formatNumber(stats.totalCalls)}
                </span>
                <span className="stat-label">Total Calls</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {formatNumber(stats.totalInputTokens)}
                </span>
                <span className="stat-label">Input Tokens</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {formatNumber(stats.totalOutputTokens)}
                </span>
                <span className="stat-label">Output Tokens</span>
              </div>
            </div>

            {stats.byModel.length > 0 && (
              <div className="stats-table-wrapper">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Calls</th>
                      <th>Input Tokens</th>
                      <th>Output Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byModel.map((row, i) => (
                      <tr key={i}>
                        <td>
                          <code className="model-name">{row.model}</code>
                        </td>
                        <td>{formatNumber(row.callCount)}</td>
                        <td>{formatNumber(row.totalInputTokens)}</td>
                        <td>{formatNumber(row.totalOutputTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* System Info (merged) */}
            {config && (
              <div className="stats-system-info">
                <span className="stats-sys-item">
                  <span className="stats-sys-label">DB</span>
                  <code>{config.databasePath}</code>
                </span>
                <span className="stats-sys-item">
                  <span className="stats-sys-label">Skills</span>
                  <code>{config.skillsDir}</code>
                </span>
              </div>
            )}
          </section>
        )}

        {/* Tools (collapsible) */}
        <section className="card settings-section">
          <h2
            className="settings-section-title settings-section-clickable"
            onClick={() => setToolsExpanded((v) => !v)}
          >
            Tools
            <span className="settings-count">{tools.length}</span>
            <span
              className={`settings-chevron${toolsExpanded ? " expanded" : ""}`}
            >
              <IconChevronDown size={16} />
            </span>
          </h2>
          {!toolsExpanded && tools.length > 0 && (
            <div className="tools-badges">
              {tools.map((tool) => (
                <span
                  key={tool.name}
                  className={`tool-badge tool-badge-${tool.category}`}
                  title={tool.description}
                >
                  {tool.name}
                </span>
              ))}
            </div>
          )}
          {toolsExpanded && (
            <div className="tools-list">
              {tools.map((tool) => (
                <div key={tool.name} className="tool-item">
                  <div className="tool-header">
                    <span className="tool-name">{tool.name}</span>
                    <span className="badge badge-info">{tool.category}</span>
                  </div>
                  <div className="tool-description">{tool.description}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Scheduled Tasks */}
        <section className="card settings-section">
          <h2 className="settings-section-title">
            Scheduled Tasks
            <span className="settings-count">{tasks.length}</span>
            <button
              className="btn-primary settings-add-btn"
              onClick={() => setShowTaskForm((v) => !v)}
            >
              {showTaskForm ? "Cancel" : "Add Task"}
            </button>
          </h2>

          {showTaskForm && (
            <div className="task-form">
              <div className="settings-field">
                <label className="settings-label">Name</label>
                <input
                  type="text"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  placeholder="Task name"
                />
              </div>
              <div className="settings-field">
                <label className="settings-label">Cron Expression</label>
                <input
                  type="text"
                  value={newTaskCron}
                  onChange={(e) => setNewTaskCron(e.target.value)}
                  placeholder="e.g. 0 */6 * * *"
                />
              </div>
              <div className="settings-field">
                <label className="settings-label">Action</label>
                <input
                  type="text"
                  value={newTaskAction}
                  onChange={(e) => setNewTaskAction(e.target.value)}
                  placeholder="Action to execute"
                />
              </div>
              <div className="settings-field settings-field-inline">
                <label className="settings-label">Enabled</label>
                <span
                  className={`skill-toggle ${newTaskEnabled ? "enabled" : "disabled"}`}
                  onClick={() => setNewTaskEnabled((v) => !v)}
                >
                  <span className="skill-toggle-knob" />
                </span>
              </div>
              <div className="settings-form-actions">
                <button
                  className="btn-primary"
                  onClick={handleCreateTask}
                  disabled={
                    taskCreating ||
                    !newTaskName.trim() ||
                    !newTaskCron.trim() ||
                    !newTaskAction.trim()
                  }
                >
                  {taskCreating ? "Creating..." : "Create Task"}
                </button>
              </div>
            </div>
          )}

          {tasks.length === 0 && !showTaskForm ? (
            <div className="settings-empty">No scheduled tasks</div>
          ) : (
            <div className="tasks-list">
              {tasks.map((task) => (
                <div key={task.id} className="task-item">
                  <div className="task-item-header">
                    <div className="task-item-left">
                      <span className="task-name">{task.name}</span>
                      <span
                        className={`badge ${task.enabled ? "badge-success" : "badge-muted"}`}
                      >
                        {task.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <div className="task-item-actions">
                      {confirmDeleteTaskId === task.id ? (
                        <span className="task-confirm-delete">
                          <span className="task-confirm-text">Delete?</span>
                          <button
                            className="btn-danger task-action-btn"
                            onClick={() => handleDeleteTask(task.id)}
                            disabled={deletingTaskId === task.id}
                          >
                            {deletingTaskId === task.id ? "..." : "Yes"}
                          </button>
                          <button
                            className="btn-secondary task-action-btn"
                            onClick={() => setConfirmDeleteTaskId(null)}
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn-secondary task-action-btn"
                          onClick={() => handleDeleteTask(task.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="task-item-details">
                    <span>
                      <span className="task-detail-label">Cron:</span>{" "}
                      <code>{task.cron}</code>
                    </span>
                    <span>
                      <span className="task-detail-label">Action:</span>{" "}
                      {task.action}
                    </span>
                    <span>
                      <span className="task-detail-label">Last Run:</span>{" "}
                      {formatTime(task.lastRunAt)}
                    </span>
                    <span>
                      <span className="task-detail-label">Next Run:</span>{" "}
                      {formatTime(task.nextRunAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

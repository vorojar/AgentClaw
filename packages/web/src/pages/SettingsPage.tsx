import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [stats, setStats] = useState<UsageStatsInfo | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tools collapse
  const [toolsExpanded, setToolsExpanded] = useState(false);

  // Scheduled tasks
  const [schedTasks, setSchedTasks] = useState<ScheduledTaskInfo[]>([]);
  const [schedExpanded, setSchedExpanded] = useState(false);
  const [showSchedForm, setShowSchedForm] = useState(false);
  const [schedSaving, setSchedSaving] = useState(false);
  const [newSchedName, setNewSchedName] = useState("");
  const [newSchedCron, setNewSchedCron] = useState("");
  const [newSchedAction, setNewSchedAction] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [configData, statsData, toolsData, schedData] = await Promise.all([
        getConfig(),
        getStats(),
        listTools(),
        listScheduledTasks(),
      ]);
      setConfig(configData);
      setStats(statsData);
      setTools(toolsData);
      setSchedTasks(schedData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateSched = async () => {
    if (!newSchedName.trim() || !newSchedCron.trim() || !newSchedAction.trim())
      return;
    setSchedSaving(true);
    try {
      const task = await createScheduledTask({
        name: newSchedName.trim(),
        cron: newSchedCron.trim(),
        action: newSchedAction.trim(),
        enabled: true,
      });
      setSchedTasks((prev) => [...prev, task]);
      setShowSchedForm(false);
      setNewSchedName("");
      setNewSchedCron("");
      setNewSchedAction("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create scheduled task",
      );
    } finally {
      setSchedSaving(false);
    }
  };

  const handleDeleteSched = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    try {
      await deleteScheduledTask(id);
      setSchedTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete scheduled task",
      );
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <>
        <PageHeader>Settings</PageHeader>
        <div className="page-body">
          <div className="settings-loading">Loading settings...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>Settings</PageHeader>
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

            {/* System Info */}
            {config && (
              <div className="stats-system-info">
                <span className="stats-sys-item">
                  <span className="stats-sys-label">Provider</span>
                  <code>{config.provider}</code>
                </span>
                {config.model && (
                  <span className="stats-sys-item">
                    <span className="stats-sys-label">Model</span>
                    <code className="model-name">{config.model}</code>
                  </span>
                )}
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

        {/* Scheduled Tasks (collapsible) */}
        <section className="card settings-section">
          <h2
            className="settings-section-title settings-section-clickable"
            onClick={() => setSchedExpanded((v) => !v)}
          >
            Scheduled Tasks
            <span className="settings-count">{schedTasks.length}</span>
            <span
              className={`settings-chevron${schedExpanded ? " expanded" : ""}`}
            >
              <IconChevronDown size={16} />
            </span>
          </h2>
          {schedExpanded && (
            <>
              {schedTasks.length === 0 && !showSchedForm && (
                <div className="settings-empty">No scheduled tasks</div>
              )}
              <div className="tasks-list">
                {schedTasks.map((task) => (
                  <div key={task.id} className="task-item">
                    <div className="task-item-header">
                      <div className="task-item-left">
                        <div
                          className={`skill-toggle${task.enabled ? " enabled" : ""}`}
                          title={task.enabled ? "Enabled" : "Disabled"}
                        >
                          <div className="skill-toggle-knob" />
                        </div>
                        <span className="task-name">{task.name}</span>
                      </div>
                      <div className="task-item-actions">
                        {confirmDeleteId === task.id ? (
                          <span className="task-confirm-delete">
                            <span className="task-confirm-text">Delete?</span>
                            <button
                              className="btn-danger task-action-btn"
                              onClick={() => handleDeleteSched(task.id)}
                              disabled={deletingId === task.id}
                            >
                              {deletingId === task.id ? "..." : "Yes"}
                            </button>
                            <button
                              className="btn-secondary task-action-btn"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn-secondary task-action-btn"
                            onClick={() => handleDeleteSched(task.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="task-item-details">
                      <span>
                        <span className="task-detail-label">Cron</span>{" "}
                        <code>{task.cron}</code>
                      </span>
                      <span>
                        <span className="task-detail-label">Action</span>{" "}
                        {task.action}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {showSchedForm && (
                <div className="task-form">
                  <div className="settings-field">
                    <label className="settings-label">Name</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Daily report..."
                      value={newSchedName}
                      onChange={(e) => setNewSchedName(e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Cron Expression</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="0 9 * * *"
                      value={newSchedCron}
                      onChange={(e) => setNewSchedCron(e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Action</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="What should the bot do..."
                      value={newSchedAction}
                      onChange={(e) => setNewSchedAction(e.target.value)}
                    />
                  </div>
                  <div className="settings-form-actions">
                    <button
                      className="btn-primary"
                      onClick={handleCreateSched}
                      disabled={
                        schedSaving ||
                        !newSchedName.trim() ||
                        !newSchedCron.trim() ||
                        !newSchedAction.trim()
                      }
                    >
                      {schedSaving ? "Saving..." : "Save"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowSchedForm(false)}
                      disabled={schedSaving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!showSchedForm && (
                <button
                  className="btn-secondary settings-add-btn"
                  onClick={() => setShowSchedForm(true)}
                  style={{ marginTop: 12, alignSelf: "flex-start" }}
                >
                  + Add Task
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

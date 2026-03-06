import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  getConfig,
  getStats,
  listTools,
  type AppConfigInfo,
  type UsageStatsInfo,
  type ToolInfo,
} from "../api/client";
import { IconChevronDown } from "../components/Icons";
import { formatNumber } from "../utils/format";
import "./SettingsPage.css";

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [stats, setStats] = useState<UsageStatsInfo | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tools collapse
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [configData, statsData, toolsData] = await Promise.all([
        getConfig(),
        getStats(),
        listTools(),
      ]);
      setConfig(configData);
      setStats(statsData);
      setTools(toolsData);
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
      </div>
    </>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import { setLanguage, getLanguage } from "../i18n";
import "./SettingsPage.css";

export function SettingsPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [stats, setStats] = useState<UsageStatsInfo | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState(getLanguage());

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
        <PageHeader>{t("settings.title")}</PageHeader>
        <div className="page-body">
          <div className="settings-loading">
            {t("settings.loadingSettings")}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader>{t("settings.title")}</PageHeader>
      <div className="page-body">
        {error && <div className="settings-error">{error}</div>}

        {/* Usage Statistics + System Info */}
        {stats && (
          <section className="card settings-section">
            <h2 className="settings-section-title">
              {t("settings.usageStats")}
            </h2>
            <div className="stats-overview">
              <div className="stat-item">
                <span className="stat-value">
                  {formatNumber(stats.totalCalls)}
                </span>
                <span className="stat-label">{t("settings.totalCalls")}</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {formatNumber(stats.totalInputTokens)}
                </span>
                <span className="stat-label">{t("settings.inputTokens")}</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {formatNumber(stats.totalOutputTokens)}
                </span>
                <span className="stat-label">{t("settings.outputTokens")}</span>
              </div>
            </div>

            {stats.byModel.length > 0 && (
              <div className="stats-table-wrapper">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>{t("settings.modelCol")}</th>
                      <th>{t("settings.callsCol")}</th>
                      <th>{t("settings.inputTokens")}</th>
                      <th>{t("settings.outputTokens")}</th>
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
                  <span className="stats-sys-label">
                    {t("settings.provider")}
                  </span>
                  <code>{config.provider}</code>
                </span>
                {config.model && (
                  <span className="stats-sys-item">
                    <span className="stats-sys-label">
                      {t("settings.model")}
                    </span>
                    <code className="model-name">{config.model}</code>
                  </span>
                )}
                <span className="stats-sys-item">
                  <span className="stats-sys-label">{t("settings.db")}</span>
                  <code>{config.databasePath}</code>
                </span>
                <span className="stats-sys-item">
                  <span className="stats-sys-label">
                    {t("settings.skillsLabel")}
                  </span>
                  <code>{config.skillsDir}</code>
                </span>
              </div>
            )}
          </section>
        )}

        {/* Language */}
        <section className="card settings-section">
          <h2 className="settings-section-title">{t("settings.language")}</h2>
          <div className="stats-system-info">
            <select
              className="memory-type-select"
              value={lang}
              onChange={(e) => {
                setLang(e.target.value);
                setLanguage(e.target.value);
              }}
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
            <span className="stats-sys-label" style={{ marginLeft: 8 }}>
              {t("settings.languageHint")}
            </span>
          </div>
        </section>

        {/* Tools (collapsible) */}
        <section className="card settings-section">
          <h2
            className="settings-section-title settings-section-clickable"
            onClick={() => setToolsExpanded((v) => !v)}
          >
            {t("settings.tools")}
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

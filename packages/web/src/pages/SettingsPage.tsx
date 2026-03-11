import { useState, useEffect, useCallback } from "react";
import { useParams, NavLink } from "react-router-dom";
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
import {
  IconSettings,
  IconChannels,
  IconSubAgents,
  IconAgents,
  IconMemory,
  IconTraces,
  IconSkills,
  IconApi,
} from "../components/Icons";
import { formatNumber } from "../utils/format";
import { setLanguage, getLanguage } from "../i18n";
import { ChannelsPage } from "./ChannelsPage";
import { SubagentsPage } from "./SubagentsPage";
import { AgentsPage } from "./AgentsPage";
import { MemoryPage } from "./MemoryPage";
import { TracesPage } from "./TracesPage";
import { SkillsPage } from "./SkillsPage";
import { ApiPage } from "./ApiPage";
import "./SettingsPage.css";

/* ── Icon for Tools (simple wrench) ── */
function IconTools({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

const TABS = [
  { id: "general", icon: IconSettings },
  { id: "channels", icon: IconChannels },
  { id: "agents", icon: IconAgents },
  { id: "subagents", icon: IconSubAgents },
  { id: "memory", icon: IconMemory },
  { id: "tools", icon: IconTools },
  { id: "skills", icon: IconSkills },
  { id: "traces", icon: IconTraces },
  { id: "api", icon: IconApi },
] as const;

/* ── General tab (the original settings content) ── */
function SettingsGeneral() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [stats, setStats] = useState<UsageStatsInfo | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState(getLanguage());

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
      <div className="settings-loading">{t("settings.loadingSettings")}</div>
    );
  }

  return (
    <>
      {error && <div className="settings-error">{error}</div>}

      {/* Usage Statistics + System Info */}
      {stats && (
        <section className="card settings-section">
          <h2 className="settings-section-title">{t("settings.usageStats")}</h2>
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
                  <span className="stats-sys-label">{t("settings.model")}</span>
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

      {/* Tools summary */}
      {tools.length > 0 && (
        <section className="card settings-section">
          <h2 className="settings-section-title">
            {t("settings.tools")}
            <span className="settings-count">{tools.length}</span>
          </h2>
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
        </section>
      )}
    </>
  );
}

/* ── Tools tab ── */
function SettingsTools() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTools()
      .then(setTools)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="settings-loading">{t("settings.loadingSettings")}</div>
    );
  }

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">
        {t("settings.tools")}
        <span className="settings-count">{tools.length}</span>
      </h2>
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
    </section>
  );
}

/* ── Settings Shell ── */
export function SettingsPage() {
  const { t } = useTranslation();
  const { tab } = useParams<{ tab?: string }>();
  const activeTab = tab || "general";

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <SettingsGeneral />;
      case "channels":
        return (
          <div className="settings-embed">
            <ChannelsPage />
          </div>
        );
      case "agents":
        return (
          <div className="settings-embed">
            <AgentsPage />
          </div>
        );
      case "subagents":
        return (
          <div className="settings-embed">
            <SubagentsPage />
          </div>
        );
      case "tools":
        return <SettingsTools />;
      case "memory":
        return (
          <div className="settings-embed">
            <MemoryPage />
          </div>
        );
      case "traces":
        return (
          <div className="settings-embed">
            <TracesPage />
          </div>
        );
      case "skills":
        return (
          <div className="settings-embed">
            <SkillsPage />
          </div>
        );
      case "api":
        return (
          <div className="settings-embed">
            <ApiPage />
          </div>
        );
      default:
        return <SettingsGeneral />;
    }
  };

  return (
    <>
      <PageHeader>{t("settings.title")}</PageHeader>
      <div className="settings-layout">
        <nav className="settings-menu">
          {TABS.map((item) => (
            <NavLink
              key={item.id}
              to={item.id === "general" ? "/settings" : `/settings/${item.id}`}
              end={item.id === "general"}
              className={({ isActive }) =>
                `settings-menu-item${isActive ? " active" : ""}`
              }
            >
              <item.icon size={16} />
              <span>{t(`settings.tabs.${item.id}`)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="settings-content">{renderContent()}</div>
      </div>
    </>
  );
}

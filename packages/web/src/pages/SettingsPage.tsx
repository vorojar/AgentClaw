import { useState, useEffect, useCallback } from "react";
import { useParams, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { useTheme } from "../components/ThemeProvider";
import {
  getConfig,
  getStats,
  listTools,
  updateAppConfig,
  validateApiKey,
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

/** 判断脱敏值是否已被修改（非 "****xxxx" 格式或空） */
function isMaskedValue(value: string | undefined): boolean {
  if (!value) return false;
  return value.startsWith("****");
}

/* ── Provider 定义 ── */
const PROVIDER_DEFS = [
  {
    id: "openai",
    label: "OpenAI Compatible",
    keyField: "openaiApiKey" as const,
    modelField: "openaiModel" as const,
    hasBaseUrl: true,
    hint: "settings.configBaseUrlHint",
    placeholder: "sk-...",
    baseUrlPlaceholder: "https://api.openai.com/v1",
    modelPlaceholder: "gpt-4o",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyField: "anthropicApiKey" as const,
    modelField: "anthropicModel" as const,
    hasBaseUrl: false,
    placeholder: "sk-ant-...",
    modelPlaceholder: "claude-sonnet-4-20250514",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    keyField: "geminiApiKey" as const,
    modelField: "geminiModel" as const,
    hasBaseUrl: false,
    placeholder: "AIza...",
    modelPlaceholder: "gemini-2.0-flash",
  },
] as const;

/* ── LLM 配置编辑区域 — 按 Provider 分卡片 ── */
function ConfigEditor({
  config,
  onSaved,
}: {
  config: AppConfigInfo;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  // Per-provider form state
  const [keys, setKeys] = useState<Record<string, string>>({
    anthropic: "",
    openai: "",
    gemini: "",
  });
  const [models, setModels] = useState<Record<string, string>>({
    anthropic: config.anthropicModel || "",
    openai: config.openaiModel || config.defaultModel || config.model || "",
    gemini: config.geminiModel || "",
  });
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(
    config.openaiBaseUrl || "",
  );
  const [activeProvider, setActiveProvider] = useState(() => {
    const raw = config.activeProvider || config.provider || "openai";
    return raw === "claude" ? "anthropic" : raw;
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const setKey = (provider: string, value: string) =>
    setKeys((prev) => ({ ...prev, [provider]: value }));
  const setModel = (provider: string, value: string) =>
    setModels((prev) => ({ ...prev, [provider]: value }));

  /** 该 provider 是否已配置（脱敏值存在） */
  const isConfigured = (def: (typeof PROVIDER_DEFS)[number]) =>
    !!config[def.keyField] &&
    config[def.keyField] !== t("settings.configNotSet");

  /** 排序：已配置排前面 */
  const sortedProviders = [...PROVIDER_DEFS].sort((a, b) => {
    const aConf = isConfigured(a) ? 0 : 1;
    const bConf = isConfigured(b) ? 0 : 1;
    return aConf - bConf;
  });

  /** Map between frontend card id and backend provider name */
  const toBackendName = (id: string) => (id === "anthropic" ? "claude" : id);
  const toFrontendId = (name: string) =>
    name === "claude" ? "anthropic" : name;

  /** 是否有任何修改 */
  const hasChanges = (() => {
    for (const def of PROVIDER_DEFS) {
      if (keys[def.id] && !isMaskedValue(keys[def.id])) return true;
      if (models[def.id] !== (config[def.modelField] || "")) return true;
    }
    if (openaiBaseUrl !== (config.openaiBaseUrl || "")) return true;
    const origActive = toFrontendId(
      config.activeProvider || config.provider || "openai",
    );
    if (activeProvider !== origActive) return true;
    return false;
  })();

  const handleValidate = async (providerId: string) => {
    const apiKey = keys[providerId];
    if (!apiKey) {
      setValidateMsg((prev) => ({
        ...prev,
        [providerId]: { ok: false, text: t("settings.configEnterKey") },
      }));
      return;
    }
    setValidating(providerId);
    setValidateMsg((prev) => ({ ...prev, [providerId]: undefined as never }));
    try {
      const params: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
        model?: string;
      } = {
        provider: toBackendName(providerId),
        apiKey,
      };
      if (providerId === "openai" && openaiBaseUrl)
        params.baseUrl = openaiBaseUrl;
      if (models[providerId]) params.model = models[providerId];
      const result = await validateApiKey(params);
      setValidateMsg((prev) => ({
        ...prev,
        [providerId]: {
          ok: result.valid,
          text: result.valid
            ? t("settings.configKeyValid")
            : t("settings.configKeyInvalid") +
              (result.error ? `: ${result.error}` : ""),
        },
      }));
    } catch (err) {
      setValidateMsg((prev) => ({
        ...prev,
        [providerId]: {
          ok: false,
          text: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setValidating(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const updates: Record<string, unknown> = {};
      // Keys
      if (keys.anthropic && !isMaskedValue(keys.anthropic))
        updates.anthropicApiKey = keys.anthropic;
      if (keys.openai && !isMaskedValue(keys.openai))
        updates.openaiApiKey = keys.openai;
      if (keys.gemini && !isMaskedValue(keys.gemini))
        updates.geminiApiKey = keys.gemini;
      // Base URL
      if (openaiBaseUrl !== (config.openaiBaseUrl || ""))
        updates.openaiBaseUrl = openaiBaseUrl || undefined;
      // Per-provider models
      for (const def of PROVIDER_DEFS) {
        if (models[def.id] !== (config[def.modelField] || ""))
          updates[def.modelField] = models[def.id] || undefined;
      }
      // Active provider
      const origActive = config.activeProvider || config.provider || "openai";
      if (activeProvider !== origActive)
        updates.activeProvider = toBackendName(activeProvider);

      if (Object.keys(updates).length === 0) {
        setSaveMsg(t("settings.configNoChanges"));
        setSaving(false);
        return;
      }
      await updateAppConfig(updates as Partial<AppConfigInfo>);
      setSaveMsg(t("settings.configSaved"));
      setKeys({ anthropic: "", openai: "", gemini: "" });
      onSaved();
    } catch (err) {
      setSaveMsg(
        err instanceof Error ? err.message : t("settings.configSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t("settings.configTitle")}</h2>
      <div className="provider-cards">
        {sortedProviders.map((def) => {
          const configured = isConfigured(def);
          const isActive =
            toBackendName(activeProvider) === toBackendName(def.id);
          const msg = validateMsg[def.id];
          return (
            <div
              key={def.id}
              className={`provider-card${configured ? " configured" : ""}${isActive ? " active" : ""}`}
            >
              <div
                className="provider-card-header"
                onClick={() => {
                  if (configured || keys[def.id]) {
                    setActiveProvider(def.id);
                  }
                }}
                style={{
                  cursor: configured || keys[def.id] ? "pointer" : "default",
                }}
              >
                <span className="provider-card-radio">
                  <span
                    className={`provider-radio${isActive ? " checked" : ""}`}
                  />
                  <span className="provider-card-name">{def.label}</span>
                </span>
                <span
                  className={`provider-card-status ${configured ? "on" : ""}`}
                >
                  {configured
                    ? t("settings.providerConnected")
                    : t("settings.providerNotSet")}
                </span>
              </div>
              <div className="provider-card-body">
                <div className="provider-card-field">
                  <label className="provider-card-label">API Key</label>
                  <input
                    type="password"
                    className="config-input"
                    placeholder={config[def.keyField] || def.placeholder}
                    value={keys[def.id]}
                    onChange={(e) => setKey(def.id, e.target.value)}
                  />
                </div>
                {(keys[def.id] || msg) && (
                  <div className="provider-card-aux">
                    {keys[def.id] && (
                      <span
                        className={`config-validate-link${validating === def.id ? " disabled" : ""}`}
                        onClick={() =>
                          validating !== def.id && handleValidate(def.id)
                        }
                      >
                        {validating === def.id
                          ? t("settings.configValidating")
                          : t("settings.configValidate")}
                      </span>
                    )}
                    {msg && (
                      <span
                        className={`config-validate-msg ${msg.ok ? "success" : "error"}`}
                      >
                        {msg.text}
                      </span>
                    )}
                  </div>
                )}
                {def.hasBaseUrl && (
                  <>
                    <div className="provider-card-field">
                      <label className="provider-card-label">Base URL</label>
                      <input
                        type="text"
                        className="config-input"
                        placeholder={def.baseUrlPlaceholder}
                        value={openaiBaseUrl}
                        onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                      />
                    </div>
                    {def.hint && (
                      <div className="provider-card-aux">
                        <span className="config-hint">{t(def.hint)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="provider-card-field">
                  <label className="provider-card-label">
                    {t("settings.model")}
                  </label>
                  <input
                    type="text"
                    className="config-input"
                    placeholder={def.modelPlaceholder}
                    value={models[def.id]}
                    onChange={(e) => setModel(def.id, e.target.value)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-form-actions">
        <button
          className="btn btn-primary"
          disabled={!hasChanges || saving}
          onClick={handleSave}
        >
          {saving ? t("settings.configSaving") : t("settings.configSave")}
        </button>
        {saveMsg && (
          <span
            className={`config-save-msg ${saveMsg === t("settings.configSaved") ? "success" : ""}`}
          >
            {saveMsg}
          </span>
        )}
      </div>
    </section>
  );
}

/* ── General tab (the original settings content) ── */
function SettingsGeneral() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [stats, setStats] = useState<UsageStatsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState(getLanguage());

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [configData, statsData] = await Promise.all([
        getConfig(),
        getStats(),
      ]);
      setConfig(configData);
      setStats(statsData);
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

      {/* LLM 配置编辑 */}
      {config && <ConfigEditor config={config} onSaved={fetchAll} />}

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

      {/* Appearance */}
      <section className="card settings-section">
        <h2 className="settings-section-title">{t("settings.appearance")}</h2>
        <div className="settings-appearance-grid">
          <div className="settings-appearance-item">
            <span className="stats-sys-label">{t("settings.language")}</span>
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
          </div>
          <div className="settings-appearance-item">
            <span className="stats-sys-label">{t("settings.theme")}</span>
            <select
              className="memory-type-select"
              value={theme}
              onChange={(e) => {
                if (e.target.value !== theme) toggle();
              }}
            >
              <option value="dark">{t("settings.themeDark")}</option>
              <option value="light">{t("settings.themeLight")}</option>
            </select>
          </div>
        </div>
      </section>
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

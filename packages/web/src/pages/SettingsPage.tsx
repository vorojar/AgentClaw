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

/* ── LLM 配置编辑区域 ── */
function ConfigEditor({
  config,
  onSaved,
}: {
  config: AppConfigInfo;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(
    config.openaiBaseUrl || "",
  );
  const [geminiKey, setGeminiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState(
    config.defaultModel || config.model || "",
  );
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<Record<string, string>>({});

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const updates: Record<string, unknown> = {};
      // 只发送非空且非脱敏的值
      if (anthropicKey && !isMaskedValue(anthropicKey)) {
        updates.anthropicApiKey = anthropicKey;
      }
      if (openaiKey && !isMaskedValue(openaiKey)) {
        updates.openaiApiKey = openaiKey;
      }
      if (openaiBaseUrl !== (config.openaiBaseUrl || "")) {
        updates.openaiBaseUrl = openaiBaseUrl || undefined;
      }
      if (geminiKey && !isMaskedValue(geminiKey)) {
        updates.geminiApiKey = geminiKey;
      }
      if (defaultModel !== (config.defaultModel || config.model || "")) {
        updates.defaultModel = defaultModel || undefined;
      }

      if (Object.keys(updates).length === 0) {
        setSaveMsg(t("settings.configNoChanges"));
        setSaving(false);
        return;
      }

      await updateAppConfig(updates as Partial<AppConfigInfo>);
      setSaveMsg(t("settings.configSaved"));
      // 清空密码输入框
      setAnthropicKey("");
      setOpenaiKey("");
      setGeminiKey("");
      onSaved();
    } catch (err) {
      setSaveMsg(
        err instanceof Error ? err.message : t("settings.configSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async (provider: string) => {
    let apiKey = "";
    let baseUrl: string | undefined;
    if (provider === "anthropic") {
      apiKey = anthropicKey;
    } else if (provider === "openai") {
      apiKey = openaiKey;
      baseUrl = openaiBaseUrl || undefined;
    } else if (provider === "gemini") {
      apiKey = geminiKey;
    }
    if (!apiKey) {
      setValidateMsg((prev) => ({
        ...prev,
        [provider]: t("settings.configEnterKey"),
      }));
      return;
    }
    setValidating(provider);
    setValidateMsg((prev) => ({ ...prev, [provider]: "" }));
    try {
      const result = await validateApiKey({
        provider,
        apiKey,
        baseUrl,
        model: defaultModel || undefined,
      });
      setValidateMsg((prev) => ({
        ...prev,
        [provider]: result.valid
          ? t("settings.configKeyValid")
          : t("settings.configKeyInvalid") + (result.error ? `: ${result.error}` : ""),
      }));
    } catch (err) {
      setValidateMsg((prev) => ({
        ...prev,
        [provider]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setValidating(null);
    }
  };

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t("settings.configTitle")}</h2>
      <div className="settings-form">
        {/* Anthropic */}
        <div className="settings-field">
          <label className="settings-label">Anthropic API Key</label>
          <div className="config-key-row">
            <input
              type="password"
              className="config-input"
              placeholder={config.anthropicApiKey || t("settings.configNotSet")}
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
            <button
              className="btn btn-sm btn-secondary"
              disabled={validating === "anthropic" || !anthropicKey}
              onClick={() => handleValidate("anthropic")}
            >
              {validating === "anthropic"
                ? t("settings.configValidating")
                : t("settings.configValidate")}
            </button>
          </div>
          {validateMsg.anthropic && (
            <span
              className={`config-validate-msg ${validateMsg.anthropic.includes(t("settings.configKeyValid")) ? "success" : "error"}`}
            >
              {validateMsg.anthropic}
            </span>
          )}
        </div>

        {/* OpenAI */}
        <div className="settings-field">
          <label className="settings-label">OpenAI API Key</label>
          <div className="config-key-row">
            <input
              type="password"
              className="config-input"
              placeholder={config.openaiApiKey || t("settings.configNotSet")}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
            <button
              className="btn btn-sm btn-secondary"
              disabled={validating === "openai" || !openaiKey}
              onClick={() => handleValidate("openai")}
            >
              {validating === "openai"
                ? t("settings.configValidating")
                : t("settings.configValidate")}
            </button>
          </div>
          {validateMsg.openai && (
            <span
              className={`config-validate-msg ${validateMsg.openai.includes(t("settings.configKeyValid")) ? "success" : "error"}`}
            >
              {validateMsg.openai}
            </span>
          )}
        </div>

        {/* OpenAI Base URL */}
        <div className="settings-field">
          <label className="settings-label">OpenAI Base URL</label>
          <input
            type="text"
            className="config-input"
            placeholder="https://api.openai.com/v1"
            value={openaiBaseUrl}
            onChange={(e) => setOpenaiBaseUrl(e.target.value)}
          />
          <span className="config-hint">
            {t("settings.configBaseUrlHint")}
          </span>
        </div>

        {/* Gemini */}
        <div className="settings-field">
          <label className="settings-label">Gemini API Key</label>
          <div className="config-key-row">
            <input
              type="password"
              className="config-input"
              placeholder={config.geminiApiKey || t("settings.configNotSet")}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
            <button
              className="btn btn-sm btn-secondary"
              disabled={validating === "gemini" || !geminiKey}
              onClick={() => handleValidate("gemini")}
            >
              {validating === "gemini"
                ? t("settings.configValidating")
                : t("settings.configValidate")}
            </button>
          </div>
          {validateMsg.gemini && (
            <span
              className={`config-validate-msg ${validateMsg.gemini.includes(t("settings.configKeyValid")) ? "success" : "error"}`}
            >
              {validateMsg.gemini}
            </span>
          )}
        </div>

        {/* Default Model */}
        <div className="settings-field">
          <label className="settings-label">{t("settings.configDefaultModel")}</label>
          <input
            type="text"
            className="config-input"
            placeholder="e.g. claude-sonnet-4-20250514"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
          />
        </div>

        {/* 保存按钮 */}
        <div className="settings-form-actions">
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={handleSave}
          >
            {saving
              ? t("settings.configSaving")
              : t("settings.configSave")}
          </button>
          {saveMsg && (
            <span
              className={`config-save-msg ${saveMsg === t("settings.configSaved") ? "success" : ""}`}
            >
              {saveMsg}
            </span>
          )}
        </div>

        <span className="config-hint">{t("settings.configRestartHint")}</span>
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

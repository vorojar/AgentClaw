import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { updateAppConfig, validateApiKey } from "../api/client";
import "./SetupWizard.css";

/** 支持的 LLM Provider 列表 */
const PROVIDERS = [
  { id: "claude", label: "Claude (Anthropic)" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini (Google)" },
  { id: "ollama", label: "Ollama" },
  { id: "compatible", label: "OpenAI Compatible" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

/** 总步骤数（弹层模式跳过 welcome，3 步） */
const TOTAL_STEPS_FULL = 4;
const TOTAL_STEPS_MODAL = 3;

interface SetupWizardProps {
  /** 弹层模式：作为 overlay 显示，完成后调用 onComplete */
  modal?: boolean;
  onComplete?: () => void;
  onClose?: () => void;
}

export function SetupWizard({
  modal,
  onComplete,
  onClose,
}: SetupWizardProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [step, setStep] = useState(modal ? 1 : 0); // modal 跳过 welcome
  const [provider, setProvider] = useState<ProviderId | null>(null);

  // 表单字段
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  // 验证状态
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── 步骤指示器 ── */
  function StepDots() {
    const total = modal ? TOTAL_STEPS_MODAL : TOTAL_STEPS_FULL;
    const current = modal ? step - 1 : step; // modal 模式从 step 1 开始，映射到 dot 0
    return (
      <div className="setup-steps">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`setup-step-dot ${i === current ? "active" : i < current ? "done" : ""}`}
          />
        ))}
      </div>
    );
  }

  /* ── 验证并保存 ── */
  async function handleValidateAndSave() {
    if (!provider) return;

    // Ollama 不需要 API key，跳过验证直接保存
    const needsApiKey = provider !== "ollama";
    if (needsApiKey && !apiKey.trim()) {
      setValidateError(t("setup.enterKeyFirst"));
      return;
    }

    setValidating(true);
    setValidateError(null);

    try {
      // 构造验证参数
      const validateProvider = provider === "compatible" ? "openai" : provider;
      const validateParams: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
        model?: string;
      } = {
        provider: validateProvider,
        apiKey: provider === "ollama" ? "ollama" : apiKey.trim(),
      };

      if (baseUrl.trim()) {
        validateParams.baseUrl = baseUrl.trim();
      }
      if (model.trim()) {
        validateParams.model = model.trim();
      }

      // Ollama 默认 base URL
      if (provider === "ollama" && !baseUrl.trim()) {
        validateParams.baseUrl = "http://localhost:11434/v1";
      }

      const result = await validateApiKey(validateParams);

      if (!result.valid) {
        setValidateError(result.error || t("setup.validationFailed"));
        setValidating(false);
        return;
      }

      // 验证通过，保存配置
      setSaving(true);

      const config: Record<string, unknown> = {};

      if (provider === "claude") {
        config.anthropicApiKey = apiKey.trim();
      } else if (provider === "openai") {
        config.openaiApiKey = apiKey.trim();
        if (baseUrl.trim()) config.openaiBaseUrl = baseUrl.trim();
      } else if (provider === "gemini") {
        config.geminiApiKey = apiKey.trim();
      } else if (provider === "ollama") {
        config.openaiApiKey = "ollama";
        config.openaiBaseUrl = baseUrl.trim() || "http://localhost:11434/v1";
      } else if (provider === "compatible") {
        config.openaiApiKey = apiKey.trim();
        if (baseUrl.trim()) config.openaiBaseUrl = baseUrl.trim();
      }

      if (model.trim()) {
        config.defaultModel = model.trim();
      }

      await updateAppConfig(config);

      // 跳到完成步骤
      setStep(3);
    } catch (err) {
      setValidateError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
      setSaving(false);
    }
  }

  /* ── 渲染各步骤 ── */
  function renderContent() {
    switch (step) {
      // 欢迎页
      case 0:
        return (
          <>
            <h1 className="setup-title">{t("setup.welcomeTitle")}</h1>
            <p className="setup-subtitle">{t("setup.welcomeSubtitle")}</p>
            <div className="setup-actions">
              <button className="btn-primary" onClick={() => setStep(1)}>
                {t("setup.getStarted")}
              </button>
            </div>
            <span className="setup-skip" onClick={() => navigate("/chat")}>
              {t("setup.skipSetup")}
            </span>
          </>
        );

      // Provider 选择
      case 1:
        return (
          <>
            <h1 className="setup-title">{t("setup.providerTitle")}</h1>
            <p className="setup-subtitle">{t("setup.providerSubtitle")}</p>
            <div className="setup-provider-grid">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  className={`setup-provider-btn ${provider === p.id ? "selected" : ""}`}
                  onClick={() => setProvider(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="setup-actions">
              <button className="btn-secondary" onClick={() => setStep(0)}>
                {t("common.prev")}
              </button>
              <button
                className="btn-primary"
                disabled={!provider}
                onClick={() => {
                  // 重置表单字段
                  setApiKey("");
                  setBaseUrl(
                    provider === "ollama" ? "http://localhost:11434/v1" : "",
                  );
                  setModel("");
                  setValidateError(null);
                  setStep(2);
                }}
                style={{ opacity: provider ? 1 : 0.5 }}
              >
                {t("common.next")}
              </button>
            </div>
          </>
        );

      // API Key 输入
      case 2:
        return (
          <>
            <h1 className="setup-title">{t("setup.credentialsTitle")}</h1>
            <p className="setup-subtitle">{t("setup.credentialsSubtitle")}</p>

            {/* API Key（Ollama 不需要） */}
            {provider !== "ollama" && (
              <div className="setup-field">
                <label>API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === "claude"
                      ? "sk-ant-..."
                      : provider === "gemini"
                        ? "AIza..."
                        : "sk-..."
                  }
                  autoFocus
                />
              </div>
            )}

            {/* Base URL（OpenAI / Ollama / Compatible） */}
            {(provider === "openai" ||
              provider === "ollama" ||
              provider === "compatible") && (
              <div className="setup-field">
                <label>Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={
                    provider === "ollama"
                      ? "http://localhost:11434/v1"
                      : "https://api.openai.com/v1"
                  }
                  autoFocus={provider === "ollama"}
                />
                {provider === "openai" && (
                  <div className="setup-hint">
                    {t("settings.configBaseUrlHint")}
                  </div>
                )}
              </div>
            )}

            {/* 模型名（Ollama / Compatible 必填，其他可选） */}
            {(provider === "ollama" || provider === "compatible") && (
              <div className="setup-field">
                <label>{t("setup.modelName")}</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === "ollama" ? "llama3.1" : "gpt-4o"}
                />
              </div>
            )}

            {/* 验证状态 */}
            {validateError && (
              <div className="setup-validate-msg error">{validateError}</div>
            )}

            <div className="setup-actions">
              <button className="btn-secondary" onClick={() => setStep(1)}>
                {t("common.prev")}
              </button>
              <button
                className="btn-primary"
                disabled={validating || saving}
                onClick={handleValidateAndSave}
                style={{
                  opacity: validating || saving ? 0.6 : 1,
                }}
              >
                {validating
                  ? t("setup.validating")
                  : saving
                    ? t("common.saving")
                    : t("setup.validateAndSave")}
              </button>
            </div>
          </>
        );

      // 完成
      case 3:
        return (
          <>
            <div className="setup-complete-icon">&#10003;</div>
            <h1 className="setup-title">{t("setup.completeTitle")}</h1>
            <p className="setup-subtitle">{t("setup.completeSubtitle")}</p>
            <div className="setup-actions">
              <button
                className="btn-primary"
                onClick={() => {
                  if (modal && onComplete) {
                    onComplete();
                  } else {
                    navigate("/chat");
                  }
                }}
              >
                {t("setup.startChatting")}
              </button>
            </div>
          </>
        );

      default:
        return null;
    }
  }

  return (
    <div className={`setup-wizard ${modal ? "setup-modal-overlay" : ""}`}>
      <div className="setup-card">
        {modal && onClose && (
          <button type="button" className="setup-close" onClick={onClose}>
            &times;
          </button>
        )}
        <StepDots />
        {renderContent()}
      </div>
    </div>
  );
}

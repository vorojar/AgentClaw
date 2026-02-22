import { useState, useEffect, useCallback } from "react";
import { getConfig, updateConfig } from "../api/client";
import "./ModelSelector.css";

const PRESET_MODELS = [
  "deepseek-chat",
  "deepseek-reasoner",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4-20250514",
  "gemini-2.0-flash",
];

interface ModelSelectorProps {
  className?: string;
}

export function ModelSelector({ className }: ModelSelectorProps) {
  const [currentModel, setCurrentModel] = useState<string>("");
  const [models, setModels] = useState<string[]>(PRESET_MODELS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then((config) => {
        const model = config.model || "";
        setCurrentModel(model);
        if (model && !PRESET_MODELS.includes(model)) {
          setModels([model, ...PRESET_MODELS]);
        }
      })
      .catch(() => {
        // silently ignore config fetch failures
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const model = e.target.value;
      setCurrentModel(model);
      try {
        await updateConfig({ model });
      } catch {
        // revert on failure — refetch config
        const config = await getConfig();
        setCurrentModel(config.model || "");
      }
    },
    [],
  );

  return (
    <div
      className={`model-selector-wrapper${className ? ` ${className}` : ""}`}
    >
      <select
        className="model-selector-select"
        value={currentModel}
        onChange={handleChange}
        disabled={loading}
      >
        {loading && <option value="">Loading...</option>}
        {!loading &&
          models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
      </select>
    </div>
  );
}

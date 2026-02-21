import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";

export function LoginPage() {
  const { login } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setError("");
    setLoading(true);
    const ok = await login(key.trim());
    setLoading(false);
    if (!ok) {
      setError("API Key 无效，请重试");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-primary)",
      }}
    >
      <div
        style={{
          width: 380,
          padding: 32,
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 8,
            color: "var(--text-primary)",
          }}
        >
          AgentClaw
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-secondary)",
            marginBottom: 24,
          }}
        >
          请输入 API Key 以继续
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="API Key"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              marginBottom: 16,
            }}
          />
          {error && (
            <p
              style={{
                fontSize: 13,
                color: "var(--error)",
                marginBottom: 12,
              }}
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !key.trim()}
            style={{
              width: "100%",
              padding: "10px 0",
              fontSize: 14,
              fontWeight: 600,
              opacity: loading || !key.trim() ? 0.6 : 1,
            }}
          >
            {loading ? "验证中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useState } from "react";
import "./ApiPage.css";

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "WS";
  path: string;
  desc: string;
  params?: string;
}

interface ApiGroup {
  name: string;
  endpoints: Endpoint[];
}

const API_GROUPS: ApiGroup[] = [
  {
    name: "Sessions",
    endpoints: [
      { method: "POST", path: "/api/sessions", desc: "Create session" },
      { method: "GET", path: "/api/sessions", desc: "List sessions" },
      { method: "DELETE", path: "/api/sessions/:id", desc: "Close session" },
      {
        method: "POST",
        path: "/api/sessions/:id/chat",
        desc: "Send message",
        params: "body: { content }",
      },
      {
        method: "GET",
        path: "/api/sessions/:id/history",
        desc: "Get history",
        params: "?limit",
      },
    ],
  },
  {
    name: "Traces",
    endpoints: [
      {
        method: "GET",
        path: "/api/traces",
        desc: "List traces",
        params: "?limit&offset",
      },
      { method: "GET", path: "/api/traces/latest", desc: "Latest trace" },
      { method: "GET", path: "/api/traces/:id", desc: "Get trace by ID" },
    ],
  },
  {
    name: "Token Logs",
    endpoints: [
      {
        method: "GET",
        path: "/api/token-logs",
        desc: "Token usage logs",
        params: "?limit&offset",
      },
    ],
  },
  {
    name: "Plans",
    endpoints: [
      { method: "GET", path: "/api/plans", desc: "List plans" },
      { method: "GET", path: "/api/plans/:id", desc: "Get plan detail" },
    ],
  },
  {
    name: "Memory",
    endpoints: [
      {
        method: "GET",
        path: "/api/memories",
        desc: "Search memories",
        params: "?q&type&limit",
      },
      { method: "DELETE", path: "/api/memories/:id", desc: "Delete memory" },
    ],
  },
  {
    name: "Tools & Skills",
    endpoints: [
      { method: "GET", path: "/api/tools", desc: "List tools" },
      { method: "GET", path: "/api/skills", desc: "List skills" },
    ],
  },
  {
    name: "Config & Stats",
    endpoints: [
      { method: "GET", path: "/api/stats", desc: "Usage statistics" },
      { method: "GET", path: "/api/config", desc: "Get config" },
      {
        method: "PUT",
        path: "/api/config",
        desc: "Update config",
        params: "body: { provider, model }",
      },
    ],
  },
  {
    name: "Scheduled Tasks",
    endpoints: [
      { method: "GET", path: "/api/tasks", desc: "List tasks" },
      {
        method: "POST",
        path: "/api/tasks",
        desc: "Create task",
        params: "body: { name, cron, action, enabled }",
      },
      { method: "DELETE", path: "/api/tasks/:id", desc: "Delete task" },
    ],
  },
  {
    name: "WebSocket",
    endpoints: [
      { method: "WS", path: "/ws?sessionId=xxx", desc: "Realtime chat stream" },
    ],
  },
  {
    name: "Auth",
    endpoints: [
      { method: "GET", path: "/api/auth/verify", desc: "Verify API key" },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "var(--success)",
  POST: "var(--accent)",
  PUT: "var(--warning)",
  DELETE: "var(--error)",
  WS: "#a78bfa",
};

function TryPanel({ endpoint }: { endpoint: Endpoint }) {
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (endpoint.method !== "GET") return null;

  async function tryIt() {
    setLoading(true);
    try {
      const apiKey = localStorage.getItem("agentclaw_api_key");
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(endpoint.path, { headers });
      const text = await res.text();
      try {
        setResult(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResult(text);
      }
    } catch (err) {
      setResult(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="api-try">
      <button
        className="btn-secondary api-try-btn"
        onClick={tryIt}
        disabled={loading}
      >
        {loading ? "..." : "Try"}
      </button>
      {result !== null && (
        <pre className="api-try-result">
          {result.slice(0, 2000)}
          {result.length > 2000 ? "\n..." : ""}
        </pre>
      )}
    </div>
  );
}

export function ApiPage() {
  return (
    <>
      <div className="page-header">API Reference</div>
      <div className="page-body">
        <div className="api-groups">
          {API_GROUPS.map((group) => (
            <section key={group.name} className="card api-group">
              <h3 className="api-group-title">{group.name}</h3>
              <div className="api-endpoints">
                {group.endpoints.map((ep, i) => (
                  <div key={i} className="api-endpoint">
                    <div className="api-endpoint-row">
                      <span
                        className="api-method"
                        style={{
                          color:
                            METHOD_COLORS[ep.method] ?? "var(--text-secondary)",
                        }}
                      >
                        {ep.method}
                      </span>
                      <code className="api-path">{ep.path}</code>
                      <span className="api-desc">{ep.desc}</span>
                      {ep.params && (
                        <span className="api-params">{ep.params}</span>
                      )}
                    </div>
                    <TryPanel endpoint={ep} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

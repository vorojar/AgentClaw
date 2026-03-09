import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./i18n";
import "./styles/global.css";

// Sentry 错误监控：仅在配置了 DSN 时初始化，否则零开销
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Sentry.ErrorBoundary
        fallback={({ error }) => (
          <div style={{ padding: 32, color: "red" }}>
            <h2>Application Error</h2>
            <pre>{error?.toString()}</pre>
          </div>
        )}
      >
        <App />
      </Sentry.ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);

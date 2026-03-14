import { Routes, Route, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "./components/Layout";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { SetupWizard } from "./pages/SetupWizard";
import { AuthProvider, useAuth } from "./auth";
import { ThemeProvider } from "./components/ThemeProvider";
import { SessionProvider } from "./components/SessionContext";

function AppRoutes() {
  const { authRequired, apiKey, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "var(--text-secondary)",
        }}
      >
        {t("common.loading")}
      </div>
    );
  }

  if (authRequired && !apiKey) {
    return <LoginPage />;
  }

  return (
    <SessionProvider>
      <Routes>
        {/* Setup Wizard — 全屏页面，不走 Layout */}
        <Route path="/setup" element={<SetupWizard />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:sessionId" element={<ChatPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
          {/* Redirects from old paths */}
          <Route
            path="/channels"
            element={<Navigate to="/settings/channels" replace />}
          />
          <Route
            path="/subagents"
            element={<Navigate to="/settings/subagents" replace />}
          />
          <Route
            path="/agents"
            element={<Navigate to="/settings/agents" replace />}
          />
          <Route
            path="/memory"
            element={<Navigate to="/settings/memory" replace />}
          />
          <Route
            path="/traces"
            element={<Navigate to="/settings/traces" replace />}
          />
          <Route
            path="/skills"
            element={<Navigate to="/settings/skills" replace />}
          />
          <Route
            path="/api"
            element={<Navigate to="/settings/api" replace />}
          />
        </Route>
      </Routes>
    </SessionProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeProvider>
  );
}

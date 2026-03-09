import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ChatPage } from "./pages/ChatPage";
import { MemoryPage } from "./pages/MemoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { TokenLogsPage } from "./pages/TokenLogsPage";
import { TracesPage } from "./pages/TracesPage";
import { TasksPage } from "./pages/TasksPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { SubagentsPage } from "./pages/SubagentsPage";
import { AgentsPage } from "./pages/AgentsPage";
import { ApiPage } from "./pages/ApiPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { AuthProvider, useAuth } from "./auth";
import { ThemeProvider } from "./components/ThemeProvider";
import { SessionProvider } from "./components/SessionContext";

function AppRoutes() {
  const { authRequired, apiKey, loading } = useAuth();

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
        Loading...
      </div>
    );
  }

  if (authRequired && !apiKey) {
    return <LoginPage />;
  }

  return (
    <SessionProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:sessionId" element={<ChatPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/edit" element={<ProjectsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/subagents" element={<SubagentsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/token-logs" element={<TokenLogsPage />} />
          <Route path="/traces" element={<TracesPage />} />
          <Route path="/api" element={<ApiPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
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

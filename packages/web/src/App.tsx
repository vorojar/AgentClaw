import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ChatPage } from "./pages/ChatPage";
import { MemoryPage } from "./pages/MemoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { TokenLogsPage } from "./pages/TokenLogsPage";
import { TracesPage } from "./pages/TracesPage";
import { ApiPage } from "./pages/ApiPage";
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
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/token-logs" element={<TokenLogsPage />} />
          <Route path="/traces" element={<TracesPage />} />
          <Route path="/api" element={<ApiPage />} />
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

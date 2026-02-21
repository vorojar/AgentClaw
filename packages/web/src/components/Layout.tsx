import { NavLink, Outlet } from "react-router-dom";

export function Layout() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">AgentClaw</div>
        <nav className="sidebar-nav">
          <NavLink
            to="/chat"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Chat
          </NavLink>
          <NavLink
            to="/plans"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Plans
          </NavLink>
          <NavLink
            to="/memory"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Memory
          </NavLink>
          <NavLink
            to="/token-logs"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Token Logs
          </NavLink>
          <NavLink
            to="/traces"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Traces
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Settings
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <NavLink
            to="/api"
            className={({ isActive }) =>
              `sidebar-api-link${isActive ? " active" : ""}`
            }
          >
            {"{ } API"}
          </NavLink>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

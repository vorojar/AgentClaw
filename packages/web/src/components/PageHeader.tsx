import { useSession } from "./SessionContext";
import { IconMenu } from "./Icons";

export function PageHeader({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, setSidebarOpen } = useSession();
  return (
    <div className="page-header">
      {!sidebarOpen && (
        <button
          className="btn-icon"
          onClick={() => setSidebarOpen(true)}
          title="Show sidebar"
        >
          <IconMenu size={18} />
        </button>
      )}
      {children}
    </div>
  );
}

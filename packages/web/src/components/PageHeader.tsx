import { useTranslation } from "react-i18next";
import { useSession } from "./SessionContext";
import { IconMenu } from "./Icons";

export function PageHeader({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, setSidebarOpen } = useSession();
  const { t } = useTranslation();
  return (
    <div className="page-header">
      {!sidebarOpen && (
        <button
          className="btn-icon"
          onClick={() => setSidebarOpen(true)}
          title={t("sidebar.show")}
        >
          <IconMenu size={18} />
        </button>
      )}
      {children}
    </div>
  );
}

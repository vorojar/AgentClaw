import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

const STORAGE_KEY = "agentclaw_api_key";

interface AuthContextValue {
  /** Whether the backend requires authentication */
  authRequired: boolean;
  /** Current API key (null if not logged in) */
  apiKey: string | null;
  /** Whether auth state is still loading */
  loading: boolean;
  /** Login with an API key — resolves true on success */
  login: (key: string) => Promise<boolean>;
  /** Clear stored credentials and log out */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authRequired: false,
  apiKey: null,
  loading: true,
  login: async () => false,
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/** Get stored API key — used by client.ts outside React tree */
export function getStoredApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Clear stored API key — used by client.ts on 401 */
export function clearStoredApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authRequired, setAuthRequired] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(
    localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);

  // Probe backend to determine if auth is required
  useEffect(() => {
    async function probe() {
      try {
        const headers: Record<string, string> = {};
        const storedKey = localStorage.getItem(STORAGE_KEY);
        if (storedKey) {
          headers["Authorization"] = `Bearer ${storedKey}`;
        }
        const res = await fetch("/api/config", { headers });
        if (res.status === 401) {
          setAuthRequired(true);
          // Stored key is invalid — clear it
          if (storedKey) {
            clearStoredApiKey();
            setApiKey(null);
          }
        } else {
          setAuthRequired(false);
        }
      } catch {
        // Network error — assume no auth required (local dev)
        setAuthRequired(false);
      } finally {
        setLoading(false);
      }
    }
    probe();
  }, []);

  const login = useCallback(async (key: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/verify", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        localStorage.setItem(STORAGE_KEY, key);
        setApiKey(key);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    clearStoredApiKey();
    setApiKey(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ authRequired, apiKey, loading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, clearToken, fetchMe, getToken, logout as apiLogout } from "./api";
import type { User } from "../types/index";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  error: null,
  logout: async () => {},
  refresh: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { user } = await fetchMe();
      setUser(user);
      setError(null);
    } catch (e) {
      // Invalid/expired token: drop it so the user lands on login cleanly.
      if (e instanceof ApiError && e.status === 401) clearToken();
      setUser(null);
      setError(e instanceof Error ? e.message : "failed to load user");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

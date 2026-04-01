"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
} from "react";
import { getToken, setToken, clearToken } from "@/lib/auth";

interface AuthContextValue {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Safely read localStorage at call time. Returns null on the server or when
 * localStorage is unavailable.
 */
function readTokenOnce(): string | null {
  if (typeof window === "undefined") return null;
  return getToken();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Lazy initialiser runs once on first render, client-side only.
  // This avoids both SSR mismatches and synchronous setState-in-effect.
  const [token, setTokenState] = useState<string | null>(readTokenOnce);

  const login = useCallback((newToken: string) => {
    setToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ token, login, logout, isAuthenticated: Boolean(token) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

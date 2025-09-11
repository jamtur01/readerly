"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type SessionValue = {
  token: string | null;
  setToken: (t: string | null) => void;
  login: (token: string) => void;
  logout: () => void;
  hydrated: boolean;
};

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("token");
    } catch {
      return null;
    }
  });
  const [hydrated, setHydrated] = useState(false);

  // mark as hydrated after first mount
  useEffect(() => {
    setHydrated(true);
  }, []);

  const setToken = useCallback((t: string | null) => {
    setTokenState(t);
    try {
      if (t) localStorage.setItem("token", t);
      else localStorage.removeItem("token");
    } catch {
      // ignore
    }
  }, []);

  const login = useCallback(
    (t: string) => {
      setToken(t);
    },
    [setToken]
  );

  const logout = useCallback(() => {
    setToken(null);
  }, [setToken]);

  const value = useMemo<SessionValue>(
    () => ({ token, setToken, login, logout, hydrated }),
    [token, setToken, login, logout, hydrated]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession() must be used within <SessionProvider>");
  }
  return ctx;
}

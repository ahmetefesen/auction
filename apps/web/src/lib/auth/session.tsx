"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { hasAnyRole, hasRole, type Role, type WalletDto } from "@auction/shared";
import { apiFetch } from "@/lib/api";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  status: string;
};

type SessionState = {
  user: SessionUser | null;
  wallet: WalletDto | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
  isBuyer: boolean;
  isSeller: boolean;
  isAdmin: boolean;
};

const SessionContext = createContext<SessionState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await apiFetch<{ user: SessionUser; wallet: WalletDto }>("/me");
      setUser(res.user);
      setWallet(res.wallet);
    } catch {
      setUser(null);
      setWallet(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  const clear = useCallback((): void => {
    setUser(null);
    setWallet(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      try {
        const res = await apiFetch<{ user: SessionUser; wallet: WalletDto }>("/me");
        if (!cancelled) {
          setUser(res.user);
          setWallet(res.wallet);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setWallet(null);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const value = useMemo<SessionState>(() => {
    const roles = user?.roles ?? [];
    return {
      user,
      wallet,
      loaded,
      refresh,
      clear,
      isBuyer: hasRole(roles, "BUYER"),
      isSeller: hasAnyRole(roles, "SELLER", "ADMIN"),
      isAdmin: hasRole(roles, "ADMIN"),
    };
  }, [user, wallet, loaded, refresh, clear]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within AuthProvider");
  }
  return ctx;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { apiFetch } from "@/lib/api";

type MeUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

export function SiteHeader() {
  const pathname = usePathname();
  const [user, setUser] = useState<MeUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void apiFetch<{ user: MeUser }>("/me")
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function logout(): void {
    startTransition(async () => {
      try {
        await apiFetch("/auth/logout", { method: "POST" });
      } catch {
        // still clear local UI
      }
      setUser(null);
      window.location.href = "/";
    });
  }

  return (
    <header className="border-b border-white/10 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-display text-2xl tracking-wide text-brass-400">
          Lotforge
        </Link>
        <nav className="flex items-center gap-5 text-sm text-mist-300">
          <Link href="/auctions" className="hover:text-mist-50">
            Auctions
          </Link>
          <Link href="/wallet" className="hover:text-mist-50">
            Wallet
          </Link>
          <Link href="/seller" className="hover:text-mist-50">
            Seller
          </Link>
          <Link href="/admin" className="hover:text-mist-50">
            Admin
          </Link>
          {!loaded ? (
            <span className="px-3 py-1.5 text-mist-300/50">…</span>
          ) : user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-mist-100 sm:inline">
                Merhaba, <span className="text-brass-400">{user.displayName}</span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={logout}
                className="rounded border border-white/20 px-3 py-1.5 text-mist-200 hover:bg-white/5 disabled:opacity-60"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded border border-brass-500/60 px-3 py-1.5 text-brass-400 hover:bg-brass-500/10"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

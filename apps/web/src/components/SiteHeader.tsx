"use client";

import Link from "next/link";
import { useTransition } from "react";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth/session";
import { useT } from "@/lib/i18n";
import { formatTry } from "@/lib/format";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function SiteHeader() {
  const t = useT();
  const { user, wallet, loaded, clear, isBuyer, isSeller, isAdmin } = useSession();
  const [pending, startTransition] = useTransition();

  function logout(): void {
    startTransition(async () => {
      try {
        await apiFetch("/auth/logout", { method: "POST" });
      } catch {
        // still clear local UI
      }
      clear();
      window.location.href = "/";
    });
  }

  return (
    <header className="border-b border-white/10 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-display text-2xl tracking-wide text-brass-400">
          Lotforge
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-4 text-sm text-mist-300 sm:gap-5">
          <Link href="/auctions" className="hover:text-mist-50">
            {t("nav.auctions")}
          </Link>
          {isBuyer ? (
            <>
              <Link href="/wallet" className="hover:text-mist-50">
                {t("nav.wallet")}
              </Link>
              <Link href="/watchlist" className="hover:text-mist-50">
                {t("nav.watchlist")}
              </Link>
            </>
          ) : null}
          {isSeller ? (
            <Link href="/seller" className="hover:text-mist-50">
              {t("nav.seller")}
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href="/admin" className="hover:text-mist-50">
              {t("nav.admin")}
            </Link>
          ) : null}
          <LanguageSwitcher />
          {!loaded ? (
            <span className="px-3 py-1.5 text-mist-300/50">{t("common.loading")}</span>
          ) : user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-mist-100 sm:inline">
                {t("nav.hello")} <span className="text-brass-400">{user.displayName}</span>
                {isBuyer && wallet ? (
                  <span className="ml-2 text-xs text-mist-300">
                    · {formatTry(wallet.availableBalance)}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={logout}
                className="rounded border border-white/20 px-3 py-1.5 text-mist-200 hover:bg-white/5 disabled:opacity-60"
              >
                {t("nav.signOut")}
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded border border-brass-500/60 px-3 py-1.5 text-brass-400 hover:bg-brass-500/10"
            >
              {t("nav.signIn")}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

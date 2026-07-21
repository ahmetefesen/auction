"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useFormatApiError } from "@/lib/use-format-api-error";

type AuthUser = {
  id: string;
  displayName: string;
  role: "BUYER" | "SELLER" | "ADMIN";
};

export default function RegisterPage() {
  const t = useT();
  const formatError = useFormatApiError();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"BUYER" | "SELLER">("BUYER");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      try {
        const res = await apiFetch<{ user: AuthUser }>("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName, role }),
        });
        sessionStorage.setItem(
          "lotforge_flash",
          JSON.stringify({
            kind: "welcome",
            name: res.user.displayName,
          }),
        );
        router.push(res.user.role === "SELLER" ? "/seller" : "/auctions");
        router.refresh();
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-4xl text-mist-50">{t("auth.registerTitle")}</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm text-mist-300">
          {t("auth.displayName")}
          <input
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-mist-300">
          {t("auth.email")}
          <input
            type="email"
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-mist-300">
          {t("auth.password")}
          <input
            type="password"
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <span className="mt-1 block text-xs text-mist-300/70">{t("auth.passwordHint")}</span>
        </label>
        <label className="block text-sm text-mist-300">
          {t("auth.role")}
          <select
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={role}
            onChange={(e) => setRole(e.target.value === "SELLER" ? "SELLER" : "BUYER")}
          >
            <option value="BUYER">{t("auth.buyer")}</option>
            <option value="SELLER">{t("auth.seller")}</option>
          </select>
        </label>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-brass-500 py-2.5 font-semibold text-ink-950 disabled:opacity-60"
        >
          {pending ? t("auth.creating") : t("auth.register")}
        </button>
      </form>
      <p className="mt-4 text-sm text-mist-300">
        {t("auth.alreadyRegistered")}{" "}
        <Link href="/login" className="text-brass-400">
          {t("auth.signIn")}
        </Link>
      </p>
    </div>
  );
}

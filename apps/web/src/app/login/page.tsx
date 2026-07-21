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

export default function LoginPage() {
  const t = useT();
  const formatError = useFormatApiError();
  const router = useRouter();
  const [email, setEmail] = useState("buyer@auction.local");
  const [password, setPassword] = useState("Password123!");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      try {
        const res = await apiFetch<{ user: AuthUser }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        sessionStorage.setItem(
          "lotforge_flash",
          JSON.stringify({
            kind: "signed_in",
            name: res.user.displayName,
          }),
        );
        const dest =
          res.user.role === "SELLER" || res.user.role === "ADMIN" ? "/seller" : "/auctions";
        router.push(dest);
        router.refresh();
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-4xl text-mist-50">{t("auth.signInTitle")}</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
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
          />
        </label>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-brass-500 py-2.5 font-semibold text-ink-950 disabled:opacity-60"
        >
          {pending ? t("auth.signingIn") : t("auth.signIn")}
        </button>
      </form>
      <p className="mt-4 text-sm text-mist-300">
        {t("auth.noAccount")}{" "}
        <Link href="/register" className="text-brass-400">
          {t("auth.register")}
        </Link>
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/api";

type AuthUser = {
  id: string;
  displayName: string;
  role: "BUYER" | "SELLER" | "ADMIN";
};

export default function LoginPage() {
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
        setError(err instanceof Error ? err.message : "Login failed");
      }
    });
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-4xl text-mist-50">Sign in</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm text-mist-300">
          Email
          <input
            type="email"
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-mist-300">
          Password
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
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-mist-300">
        No account?{" "}
        <Link href="/register" className="text-brass-400">
          Register
        </Link>
      </p>
    </div>
  );
}

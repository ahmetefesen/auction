"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/api";

export default function RegisterPage() {
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
        await apiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName, role }),
        });
        router.push("/auctions");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Registration failed");
      }
    });
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-4xl text-mist-50">Create account</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm text-mist-300">
          Display name
          <input
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="block text-sm text-mist-300">
          Email
          <input
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm text-mist-300">
          Password
          <input
            type="password"
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="block text-sm text-mist-300">
          Role
          <select
            className="mt-1 w-full border border-white/15 bg-ink-900 px-3 py-2"
            value={role}
            onChange={(e) => setRole(e.target.value === "SELLER" ? "SELLER" : "BUYER")}
          >
            <option value="BUYER">Buyer</option>
            <option value="SELLER">Seller</option>
          </select>
        </label>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-brass-500 py-2.5 font-semibold text-ink-950 disabled:opacity-60"
        >
          Register
        </button>
      </form>
      <p className="mt-4 text-sm text-mist-300">
        Already registered?{" "}
        <Link href="/login" className="text-brass-400">
          Sign in
        </Link>
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { apiFetch } from "@/lib/api";
import { formatTry } from "@/lib/format";

type WalletResponse = {
  wallet: { availableBalance: number; heldBalance: number };
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    createdAt: string;
  }>;
};

export default function WalletPage() {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [amount, setAmount] = useState("10000");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load(): void {
    startTransition(async () => {
      try {
        const res = await apiFetch<WalletResponse>("/wallets/me");
        setData(res);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load wallet");
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  function deposit(): void {
    startTransition(async () => {
      try {
        await apiFetch("/wallets/deposit", {
          method: "POST",
          body: JSON.stringify({ amountCents: Number.parseInt(amount, 10) }),
        });
        load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deposit failed");
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-4xl text-mist-50">Wallet</h1>
      <p className="mt-2 text-mist-300">Escrow holds use available balance during bidding.</p>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}
      {data ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="border border-white/10 p-5">
            <p className="text-sm text-mist-300">Available</p>
            <p className="font-display text-3xl text-brass-400">
              {formatTry(data.wallet.availableBalance)}
            </p>
          </div>
          <div className="border border-white/10 p-5">
            <p className="text-sm text-mist-300">Held</p>
            <p className="font-display text-3xl text-mist-50">{formatTry(data.wallet.heldBalance)}</p>
          </div>
        </div>
      ) : null}
      <div className="mt-8 flex gap-3">
        <input
          className="flex-1 border border-white/15 bg-ink-900 px-3 py-2"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount in cents"
        />
        <button
          type="button"
          disabled={pending}
          onClick={deposit}
          className="bg-brass-500 px-4 py-2 font-semibold text-ink-950 disabled:opacity-60"
        >
          Mock deposit
        </button>
      </div>
      <ul className="mt-10 space-y-2">
        {(data?.transactions ?? []).map((tx) => (
          <li key={tx.id} className="flex justify-between border-b border-white/5 py-2 text-sm">
            <span className="text-mist-300">
              {tx.type} · {new Date(tx.createdAt).toLocaleString()}
            </span>
            <span className="text-mist-50">{formatTry(tx.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

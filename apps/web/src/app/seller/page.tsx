"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { AuctionDto } from "@auction/shared";
import { apiFetch } from "@/lib/api";
import { formatTry } from "@/lib/format";
import { FlashBanner } from "@/components/FlashBanner";

type WinnerInsights = {
  winner: { id: string; displayName: string; emailMasked: string };
  trustScore: number;
  purchases: Array<{ auctionId: string; title: string; amountCents: number; settledAt: string }>;
};

export default function SellerPage() {
  const [items, setItems] = useState<AuctionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [insights, setInsights] = useState<WinnerInsights | null>(null);
  const [insightsTitle, setInsightsTitle] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    startingPrice: "10000",
    minIncrement: "500",
    durationHours: "24",
  });

  function load(): void {
    startTransition(async () => {
      try {
        const res = await apiFetch<{ items: AuctionDto[] }>("/me/auctions");
        setItems(res.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  function createAuction(): void {
    startTransition(async () => {
      setError(null);
      setSuccess(null);
      const title = form.title.trim();
      const description = form.description.trim();
      const startingPrice = Number.parseInt(form.startingPrice, 10);
      const minIncrement = Number.parseInt(form.minIncrement, 10);
      const durationHours = Number.parseInt(form.durationHours, 10);
      if (title.length < 3) {
        setError("Title must be at least 3 characters");
        return;
      }
      if (!description) {
        setError("Description is required");
        return;
      }
      if (!Number.isFinite(startingPrice) || startingPrice <= 0) {
        setError("Starting price must be a positive integer (cents)");
        return;
      }
      if (!Number.isFinite(minIncrement) || minIncrement <= 0) {
        setError("Min increment must be a positive integer (cents)");
        return;
      }
      if (!Number.isFinite(durationHours) || durationHours <= 0) {
        setError("Duration must be a positive number of hours");
        return;
      }
      try {
        const startsAt = new Date().toISOString();
        const endsAt = new Date(Date.now() + durationHours * 3600_000).toISOString();
        const created = await apiFetch<{ auction: AuctionDto }>("/auctions", {
          method: "POST",
          body: JSON.stringify({
            title,
            description,
            startingPrice,
            minIncrement,
            startsAt,
            endsAt,
          }),
        });
        await apiFetch(`/auctions/${created.auction.id}/publish`, { method: "POST" });
        setForm({ ...form, title: "", description: "" });
        setSuccess(`Published “${created.auction.title}”`);
        load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Create failed");
      }
    });
  }

  function openInsights(auction: AuctionDto): void {
    startTransition(async () => {
      try {
        const data = await apiFetch<WinnerInsights>(`/auctions/${auction.id}/winner-insights`);
        setInsights(data);
        setInsightsTitle(auction.title);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Insights failed");
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <FlashBanner />
      <h1 className="font-display text-4xl text-mist-50">Seller desk</h1>
      <p className="mt-2 text-mist-300">Create lots and review settled winners.</p>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}
      {success ? <p className="mt-4 text-brass-300">{success}</p> : null}
      <div className="mt-8 space-y-3">
        <input
          className="w-full border border-white/15 bg-ink-900 px-3 py-2"
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <textarea
          className="w-full border border-white/15 bg-ink-900 px-3 py-2"
          placeholder="Description"
          rows={4}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <div className="grid grid-cols-3 gap-3">
          <input
            className="border border-white/15 bg-ink-900 px-3 py-2"
            placeholder="Start cents"
            value={form.startingPrice}
            onChange={(e) => setForm({ ...form, startingPrice: e.target.value })}
          />
          <input
            className="border border-white/15 bg-ink-900 px-3 py-2"
            placeholder="Increment"
            value={form.minIncrement}
            onChange={(e) => setForm({ ...form, minIncrement: e.target.value })}
          />
          <input
            className="border border-white/15 bg-ink-900 px-3 py-2"
            placeholder="Hours"
            value={form.durationHours}
            onChange={(e) => setForm({ ...form, durationHours: e.target.value })}
          />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={createAuction}
          className="bg-brass-500 px-4 py-2 font-semibold text-ink-950 disabled:opacity-60"
        >
          Create & publish
        </button>
      </div>
      <ul className="mt-12 space-y-3">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-4 border-b border-white/10 py-3">
            <div>
              <Link href={`/auctions/${a.id}`} className="text-mist-50 hover:text-brass-400">
                {a.title}
              </Link>
              <p className="text-sm text-mist-300">
                {a.status} · {formatTry(a.currentBid || a.startingPrice)}
              </p>
            </div>
            {a.status === "SETTLED" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => openInsights(a)}
                className="shrink-0 text-sm text-brass-400 hover:underline"
              >
                View Winner Insights
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {insights ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg border border-white/15 bg-ink-900 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-brass-400">Winner insights</p>
                <h2 className="font-display text-2xl text-mist-50">{insightsTitle}</h2>
              </div>
              <button
                type="button"
                className="text-mist-300 hover:text-mist-50"
                onClick={() => setInsights(null)}
              >
                Close
              </button>
            </div>
            <p className="mt-4 text-mist-100">
              {insights.winner.displayName} · {insights.winner.emailMasked}
            </p>
            <p className="mt-2 text-sm text-mist-300">
              Trust score: <span className="text-brass-400">{insights.trustScore}/100</span>
            </p>
            <ul className="mt-6 max-h-56 space-y-2 overflow-y-auto text-sm">
              {insights.purchases.map((p) => (
                <li key={p.auctionId} className="flex justify-between border-b border-white/5 py-2">
                  <span className="text-mist-300">{p.title}</span>
                  <span className="text-mist-50">{formatTry(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

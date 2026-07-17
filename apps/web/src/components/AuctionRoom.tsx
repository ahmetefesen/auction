"use client";

import { useEffect, useState, useTransition } from "react";
import type { AuctionDto } from "@auction/shared";
import { apiFetch } from "@/lib/api";
import { formatCountdown, formatTry } from "@/lib/format";
import { useAuctionSocket, useSyncedNow } from "@/lib/use-auction-socket";

export function AuctionRoom({
  initial,
  apiUrl,
}: {
  initial: AuctionDto;
  apiUrl: string;
}) {
  const live = useAuctionSocket(initial.id);
  const now = useSyncedNow(live.serverOffsetMs);
  const [amount, setAmount] = useState(() =>
    String(
      initial.currentBid > 0
        ? initial.currentBid + initial.minIncrement
        : initial.startingPrice,
    ),
  );
  const [proxyMax, setProxyMax] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [optimisticBid, setOptimisticBid] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const currentBid = live.currentBid ?? optimisticBid ?? initial.currentBid;
  const endsAt = live.endsAt ?? initial.endsAt;
  const status = live.ended ? "ENDED" : initial.status;

  useEffect(() => {
    setAmount(String(currentBid > 0 ? currentBid + initial.minIncrement : initial.startingPrice));
  }, [currentBid, initial.minIncrement, initial.startingPrice]);

  function placeBid(): void {
    const cents = Number.parseInt(amount, 10);
    setOptimisticBid(cents);
    setMessage("Submitting…");
    startTransition(async () => {
      try {
        await apiFetch(`/auctions/${initial.id}/bids`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ amountCents: cents }),
        });
        setMessage("Bid placed");
      } catch (err) {
        setOptimisticBid(null);
        setMessage(err instanceof Error ? err.message : "Bid failed");
      }
    });
  }

  function setProxy(): void {
    startTransition(async () => {
      setMessage(null);
      try {
        const cents = Number.parseInt(proxyMax, 10);
        await apiFetch(`/auctions/${initial.id}/proxy-bid`, {
          method: "PUT",
          body: JSON.stringify({ maxAmountCents: cents }),
        });
        setMessage("Proxy max set");
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Proxy failed");
      }
    });
  }

  const image = initial.images[0];

  return (
    <section className="relative min-h-[calc(100vh-4.5rem)]">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: image
            ? `url('${apiUrl}${image.url}')`
            : "url('https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?auto=format&fit=crop&w=2000&q=80')",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/40" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col justify-end">
          <p className="text-xs uppercase tracking-[0.2em] text-brass-400">{status}</p>
          <h1 className="mt-3 font-display text-5xl text-mist-50 md:text-6xl">{initial.title}</h1>
          <p className="mt-4 max-w-xl text-mist-300">{initial.description}</p>
        </div>

        <div
          className={`border bg-ink-900/85 p-6 backdrop-blur transition ${
            live.outbidFlash ? "border-red-400/70 shadow-[0_0_40px_rgba(248,113,113,0.25)]" : "border-white/10"
          }`}
        >
          {live.outbidFlash ? (
            <p className="mb-3 text-sm font-semibold text-red-300">You were outbid</p>
          ) : null}
          <p className="text-sm text-mist-300">Current bid</p>
          <p className="font-display text-5xl text-brass-400 transition-all">
            {formatTry(currentBid || initial.startingPrice)}
          </p>
          <p className="mt-4 text-sm text-mist-300">Time remaining</p>
          <p className="font-mono text-3xl tabular-nums text-mist-50">
            {formatCountdown(endsAt, now)}
          </p>

          <label className="mt-6 block text-sm text-mist-300">
            Your bid (cents)
            <input
              className="mt-1 w-full border border-white/15 bg-ink-950 px-3 py-2 text-mist-50 outline-none focus:border-brass-500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={pending || live.ended}
            />
          </label>
          <button
            type="button"
            disabled={pending || live.ended}
            onClick={placeBid}
            className="mt-3 w-full bg-brass-500 py-2.5 text-sm font-semibold text-ink-950 hover:bg-brass-400 disabled:opacity-60"
          >
            {pending ? "Placing…" : "Place bid"}
          </button>

          <label className="mt-5 block text-sm text-mist-300">
            Proxy max (cents)
            <input
              className="mt-1 w-full border border-white/15 bg-ink-950 px-3 py-2 text-mist-50 outline-none focus:border-brass-500"
              value={proxyMax}
              onChange={(e) => setProxyMax(e.target.value)}
              disabled={pending || live.ended}
            />
          </label>
          <button
            type="button"
            disabled={pending || live.ended}
            onClick={setProxy}
            className="mt-3 w-full border border-white/20 py-2.5 text-sm text-mist-100 hover:border-brass-500/60 disabled:opacity-60"
          >
            Set proxy bid
          </button>
          {message ? <p className="mt-4 text-sm text-brass-400">{message}</p> : null}

          <div className="mt-8 border-t border-white/10 pt-4">
            <p className="text-sm text-mist-300">Bid history</p>
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
              {(live.liveBids.length > 0 ? live.liveBids : []).slice(0, 20).map((b) => (
                <li key={b.id} className="flex justify-between text-mist-100">
                  <span className="truncate text-mist-300">
                    {b.bidderId.slice(0, 8)}…{b.isProxy ? " (proxy)" : ""}
                  </span>
                  <span className="tabular-nums text-brass-400">{formatTry(b.amount)}</span>
                </li>
              ))}
              {live.liveBids.length === 0 ? (
                <li className="text-mist-300">No bids yet — be the first.</li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

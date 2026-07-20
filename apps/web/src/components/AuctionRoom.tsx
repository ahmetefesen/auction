"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { AuctionDto, BidPreviewDto } from "@auction/shared";
import { maskBidderId } from "@auction/shared";
import { apiFetch, ApiClientError } from "@/lib/api";
import { formatCountdown, formatTry } from "@/lib/format";
import { useAuctionSocket, useSyncedNow } from "@/lib/use-auction-socket";

const PREVIEW_DEBOUNCE_MS = 300;

function latencyLabel(
  connected: boolean,
  latencyMs: number | null,
  quality: "good" | "ok" | "poor" | "offline",
): string {
  if (!connected || quality === "offline") return "Kopuk";
  if (latencyMs == null) return "Canlı";
  const tone =
    quality === "good" ? "Canlı" : quality === "ok" ? "Stabil" : "Yavaş";
  return `${latencyMs}ms · ${tone}`;
}

export function AuctionRoom({
  initial,
  apiUrl,
}: {
  initial: AuctionDto;
  apiUrl: string;
}) {
  const live = useAuctionSocket(initial.id, () => setOptimisticBid(null));
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
  const [preview, setPreview] = useState<BidPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number | null>(null);
  const [cooldownTotalSec, setCooldownTotalSec] = useState(0);
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState(0);
  const [counterInput, setCounterInput] = useState("");
  const [pending, startTransition] = useTransition();
  const cooldownTotalRef = useRef(0);

  const currentBid = live.currentBid ?? optimisticBid ?? initial.currentBid;
  const endsAt = live.endsAt ?? initial.endsAt;
  const negotiating = live.negotiating || initial.status === "NEGOTIATING";
  const status = live.ended ? "ENDED" : negotiating ? "NEGOTIATING" : initial.status;
  const negotiationExpiresAt =
    live.negotiationExpiresAt ?? initial.negotiationExpiresAt;
  const counterOfferCents = live.counterOfferCents ?? initial.counterOfferCents;
  const amountCents = Number.parseInt(amount, 10);
  const amountValid = Number.isFinite(amountCents) && amountCents > 0;
  const inCooldown = cooldownUntilMs != null && Date.now() < cooldownUntilMs;

  useEffect(() => {
    setAmount(String(currentBid > 0 ? currentBid + initial.minIncrement : initial.startingPrice));
  }, [currentBid, initial.minIncrement, initial.startingPrice]);

  useEffect(() => {
    if (cooldownUntilMs == null) {
      setCooldownRemainingSec(0);
      return;
    }
    const tick = (): void => {
      const remainingMs = cooldownUntilMs - Date.now();
      if (remainingMs <= 0) {
        setCooldownUntilMs(null);
        setCooldownRemainingSec(0);
        setCooldownTotalSec(0);
        cooldownTotalRef.current = 0;
        setMessage(null);
        return;
      }
      const sec = Math.ceil(remainingMs / 1000);
      setCooldownRemainingSec(sec);
      setMessage(
        `Çok hızlı teklif veriyorsunuz! Yeni teklif için ${sec} sn bekleyin…`,
      );
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [cooldownUntilMs]);

  useEffect(() => {
    if (!amountValid || live.ended || negotiating) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await apiFetch<BidPreviewDto>(`/auctions/${initial.id}/bid-preview`, {
            method: "POST",
            body: JSON.stringify({ amountCents }),
          });
          setPreview(data);
          setPreviewError(null);
        } catch (err) {
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : "Preview unavailable");
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [amountCents, amountValid, initial.id, live.ended, negotiating, currentBid, endsAt]);

  function startCooldown(err: unknown): void {
    if (!(err instanceof ApiClientError) || err.code !== "BID_RATE_LIMITED") {
      setMessage(err instanceof Error ? err.message : "Bid failed");
      return;
    }
    const sec = err.retryAfterSec ?? 2;
    cooldownTotalRef.current = sec;
    setCooldownTotalSec(sec);
    setCooldownUntilMs(Date.now() + sec * 1000);
    setCooldownRemainingSec(sec);
    setMessage(`Çok hızlı teklif veriyorsunuz! Yeni teklif için ${sec} sn bekleyin…`);
  }

  function placeBid(): void {
    if (!amountValid || inCooldown) return;
    setOptimisticBid(amountCents);
    setMessage("Submitting…");
    startTransition(async () => {
      try {
        await apiFetch(`/auctions/${initial.id}/bids`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ amountCents }),
        });
        setMessage("Bid placed");
        setOptimisticBid(null);
      } catch (err) {
        setOptimisticBid(null);
        startCooldown(err);
      }
    });
  }

  function setProxy(): void {
    if (inCooldown || negotiating) return;
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
        startCooldown(err);
      }
    });
  }

  function runNegotiation(path: string, body?: object): void {
    startTransition(async () => {
      try {
        await apiFetch(path, {
          method: "POST",
          body: body ? JSON.stringify(body) : undefined,
        });
        setMessage("Negotiation updated");
        await live.refetchSnapshot();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Negotiation failed");
      }
    });
  }

  const image = initial.images[0];
  const bidDisabled =
    pending ||
    live.ended ||
    negotiating ||
    inCooldown ||
    !amountValid ||
    (preview != null && (!preview.meetsMinimum || preview.insufficientFunds));

  const pingText = latencyLabel(live.connected, live.latencyMs, live.connectionQuality);
  const pingClass =
    live.connectionQuality === "offline" || live.connectionQuality === "poor"
      ? "text-red-300"
      : live.connectionQuality === "ok"
        ? "text-brass-400"
        : "text-emerald-400";

  const cooldownProgress =
    inCooldown && cooldownTotalSec > 0
      ? Math.min(1, Math.max(0, cooldownRemainingSec / cooldownTotalSec))
      : 0;

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

      <div
        className={`absolute right-4 top-4 z-10 border border-white/10 bg-ink-950/80 px-3 py-1.5 font-mono text-xs backdrop-blur ${pingClass}`}
        title="Socket connection latency"
      >
        {pingText}
      </div>

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
            {negotiating && negotiationExpiresAt
              ? formatCountdown(negotiationExpiresAt, now)
              : formatCountdown(endsAt, now)}
          </p>

          {negotiating ? (
            <div className="mt-6 space-y-3 border border-brass-500/40 bg-ink-950/60 p-4 text-sm text-mist-200">
              <p className="font-semibold text-brass-400">Reserve not met — negotiation</p>
              <p>
                High bid {formatTry(currentBid)} is below reserve. Window ends{" "}
                {negotiationExpiresAt
                  ? new Date(negotiationExpiresAt).toLocaleString()
                  : "soon"}
                .
              </p>
              {counterOfferCents != null ? (
                <p>Seller counter: {formatTry(counterOfferCents)}</p>
              ) : (
                <p>No counter-offer yet.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  className="bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 disabled:opacity-60"
                  onClick={() => runNegotiation(`/auctions/${initial.id}/negotiation/accept`)}
                >
                  Seller: accept high bid
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="border border-white/20 px-3 py-1.5 text-xs disabled:opacity-60"
                  onClick={() => {
                    const cents = Number.parseInt(counterInput, 10);
                    if (!Number.isFinite(cents)) return;
                    runNegotiation(`/auctions/${initial.id}/negotiation/counter`, {
                      amountCents: cents,
                    });
                  }}
                >
                  Seller: counter
                </button>
                <button
                  type="button"
                  disabled={pending || counterOfferCents == null}
                  className="border border-brass-500/50 px-3 py-1.5 text-xs text-brass-400 disabled:opacity-60"
                  onClick={() =>
                    runNegotiation(`/auctions/${initial.id}/negotiation/accept-counter`)
                  }
                >
                  Buyer: accept counter
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="border border-red-400/40 px-3 py-1.5 text-xs text-red-300 disabled:opacity-60"
                  onClick={() => runNegotiation(`/auctions/${initial.id}/negotiation/decline`)}
                >
                  Decline
                </button>
              </div>
              <input
                className="mt-1 w-full border border-white/15 bg-ink-950 px-3 py-2 text-mist-50"
                placeholder="Counter amount (cents)"
                value={counterInput}
                onChange={(e) => setCounterInput(e.target.value)}
                disabled={pending}
              />
            </div>
          ) : null}

          {!negotiating ? (
            <>
          <label className="mt-6 block text-sm text-mist-300">
            Your bid (cents)
            <input
              className="mt-1 w-full border border-white/15 bg-ink-950 px-3 py-2 text-mist-50 outline-none focus:border-brass-500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={pending || live.ended || inCooldown}
            />
          </label>

          {preview ? (
            <div className="mt-3 space-y-1 border border-white/10 bg-ink-950/50 px-3 py-2 text-xs text-mist-300">
              <p>
                {preview.insufficientFunds ? (
                  <span className="text-red-300">
                    Insufficient funds — need {formatTry(preview.holdDeltaCents)} available
                    (have {formatTry(preview.availableBalanceCents)}).
                  </span>
                ) : (
                  <>This bid will hold {formatTry(preview.holdDeltaCents)} from your wallet.</>
                )}
              </p>
              <p>
                {!preview.meetsMinimum ? (
                  <span className="text-red-300">
                    Below minimum ({formatTry(preview.minRequiredCents)}).
                  </span>
                ) : preview.becomesLeader ? (
                  "You would become the current leader."
                ) : (
                  "You would not become the leader at this amount."
                )}
              </p>
              {preview.wouldExtend ? (
                <p className="text-brass-400">
                  Anti-snipe: end time extends to{" "}
                  {preview.extendedEndsAt
                    ? new Date(preview.extendedEndsAt).toLocaleTimeString()
                    : "—"}
                  .
                </p>
              ) : null}
            </div>
          ) : previewError ? (
            <p className="mt-2 text-xs text-mist-300">{previewError}</p>
          ) : null}

          {inCooldown ? (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden bg-ink-950">
                <div
                  className="h-full bg-brass-500 transition-[width] duration-100"
                  style={{ width: `${cooldownProgress * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          <button
            type="button"
            disabled={bidDisabled}
            onClick={placeBid}
            className="mt-3 w-full bg-brass-500 py-2.5 text-sm font-semibold text-ink-950 hover:bg-brass-400 disabled:opacity-60"
          >
            {pending ? "Placing…" : inCooldown ? `Wait ${cooldownRemainingSec}s` : "Place bid"}
          </button>

          <label className="mt-5 block text-sm text-mist-300">
            Proxy max (cents)
            <input
              className="mt-1 w-full border border-white/15 bg-ink-950 px-3 py-2 text-mist-50 outline-none focus:border-brass-500"
              value={proxyMax}
              onChange={(e) => setProxyMax(e.target.value)}
              disabled={pending || live.ended || inCooldown}
            />
          </label>
          <button
            type="button"
            disabled={pending || live.ended || inCooldown}
            onClick={setProxy}
            className="mt-3 w-full border border-white/20 py-2.5 text-sm text-mist-100 hover:border-brass-500/60 disabled:opacity-60"
          >
            Set proxy bid
          </button>
          {message ? (
            <p className={`mt-4 text-sm ${inCooldown ? "text-red-300" : "text-brass-400"}`}>{message}</p>
          ) : null}
            </>
          ) : message ? (
            <p className="mt-4 text-sm text-brass-400">{message}</p>
          ) : null}

          <div className="mt-8 border-t border-white/10 pt-4">
            <p className="text-sm text-mist-300">Bid history</p>
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
              {(live.liveBids.length > 0 ? live.liveBids : []).slice(0, 20).map((b) => (
                <li key={b.id} className="flex justify-between text-mist-100">
                  <span className="truncate text-mist-300">
                    {maskBidderId(b.bidderId)}
                    {b.isProxy ? " (proxy)" : ""}
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

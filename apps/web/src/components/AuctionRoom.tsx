"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { AuctionDto, BidPreviewDto } from "@auction/shared";
import { maskBidderId } from "@auction/shared";
import { apiFetch, ApiClientError } from "@/lib/api";
import { useSession } from "@/lib/auth/session";
import { formatCountdown, formatTry } from "@/lib/format";
import { useT, useLocale, localeToBcp47 } from "@/lib/i18n";
import { useFormatApiError } from "@/lib/use-format-api-error";
import { useAuctionSocket, useSyncedNow } from "@/lib/use-auction-socket";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { StatusBadge } from "@/components/ui/StatusBadge";

const PREVIEW_DEBOUNCE_MS = 300;

function latencyLabel(
  connected: boolean,
  latencyMs: number | null,
  quality: "good" | "ok" | "poor" | "offline",
  t: (path: string) => string,
): string {
  if (!connected || quality === "offline") return t("room.offline");
  if (latencyMs == null) return t("room.live");
  const tone =
    quality === "good" ? t("room.live") : quality === "ok" ? t("room.stable") : t("room.slow");
  return `${latencyMs}ms · ${tone}`;
}

export function AuctionRoom({
  initial,
  apiUrl,
}: {
  initial: AuctionDto;
  apiUrl: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const formatError = useFormatApiError();
  const bcp47 = localeToBcp47(locale);
  const { user, isBuyer } = useSession();
  const live = useAuctionSocket(initial.id, () => setOptimisticBid(null));
  const now = useSyncedNow(live.serverOffsetMs);
  const defaultBid =
    initial.currentBid > 0
      ? initial.currentBid + initial.minIncrement
      : initial.startingPrice;
  const [amountCents, setAmountCents] = useState<number | null>(defaultBid);
  const [proxyMaxCents, setProxyMaxCents] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [optimisticBid, setOptimisticBid] = useState<number | null>(null);
  const [preview, setPreview] = useState<BidPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number | null>(null);
  const [cooldownTotalSec, setCooldownTotalSec] = useState(0);
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState(0);
  const [counterCents, setCounterCents] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  const [myProxyMax, setMyProxyMax] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const cooldownTotalRef = useRef(0);

  const currentBid = live.currentBid ?? optimisticBid ?? initial.currentBid;
  const endsAt = live.endsAt ?? initial.endsAt;
  const winnerId = live.winnerId ?? initial.currentWinnerId;
  const negotiating = live.negotiating || initial.status === "NEGOTIATING";
  const settled = live.settled || initial.status === "SETTLED";
  const ended = live.ended || initial.status === "ENDED" || settled;
  const status = settled
    ? "SETTLED"
    : negotiating
      ? "NEGOTIATING"
      : ended
        ? "ENDED"
        : initial.status;
  const negotiationExpiresAt =
    live.negotiationExpiresAt ?? initial.negotiationExpiresAt;
  const counterOfferCents = live.counterOfferCents ?? initial.counterOfferCents;
  const wallet = live.wallet;
  const amountValid = amountCents != null && amountCents > 0;
  const inCooldown = cooldownUntilMs != null && Date.now() < cooldownUntilMs;

  const isSellerHere = Boolean(user && user.id === initial.sellerId);
  const isHighBidder = Boolean(user && winnerId && user.id === winnerId);
  const isWinning = isHighBidder && !ended && !negotiating;
  const canBid = isBuyer && !isSellerHere && !ended && !negotiating;

  useEffect(() => {
    setAmountCents(currentBid > 0 ? currentBid + initial.minIncrement : initial.startingPrice);
  }, [currentBid, initial.minIncrement, initial.startingPrice]);

  useEffect(() => {
    if (!isBuyer || !user) return;
    void apiFetch<{ items: Array<{ auctionId: string }> }>("/me/watchlist")
      .then((res) => {
        setWatching(res.items.some((i) => i.auctionId === initial.id));
      })
      .catch(() => {
        /* ignore */
      });
    void apiFetch<{ maxAmountCents: number | null }>(`/auctions/${initial.id}/proxy-bid`)
      .then((res) => {
        setMyProxyMax(res.maxAmountCents);
        if (res.maxAmountCents != null) setProxyMaxCents(res.maxAmountCents);
      })
      .catch(() => {
        /* ignore */
      });
  }, [isBuyer, user, initial.id]);

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
      setMessage(t("room.rateLimit", { sec }));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [cooldownUntilMs, t]);

  useEffect(() => {
    if (!canBid || !amountValid) {
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
          setPreviewError(formatError(err));
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [amountCents, amountValid, initial.id, canBid, currentBid, endsAt, formatError]);

  function startCooldown(err: unknown): void {
    if (!(err instanceof ApiClientError) || err.code !== "BID_RATE_LIMITED") {
      setMessage(formatError(err));
      return;
    }
    const sec = err.retryAfterSec ?? 2;
    cooldownTotalRef.current = sec;
    setCooldownTotalSec(sec);
    setCooldownUntilMs(Date.now() + sec * 1000);
    setCooldownRemainingSec(sec);
    setMessage(t("room.rateLimit", { sec }));
  }

  function placeBid(): void {
    if (!amountValid || !amountCents || inCooldown || !canBid) return;
    setOptimisticBid(amountCents);
    setMessage(t("room.submitting"));
    startTransition(async () => {
      try {
        await apiFetch(`/auctions/${initial.id}/bids`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ amountCents }),
        });
        setMessage(t("room.bidPlaced"));
        setOptimisticBid(null);
      } catch (err) {
        setOptimisticBid(null);
        startCooldown(err);
      }
    });
  }

  function setProxy(): void {
    if (inCooldown || negotiating || !canBid || proxyMaxCents == null) return;
    startTransition(async () => {
      setMessage(null);
      try {
        await apiFetch(`/auctions/${initial.id}/proxy-bid`, {
          method: "PUT",
          body: JSON.stringify({ maxAmountCents: proxyMaxCents }),
        });
        setMyProxyMax(proxyMaxCents);
        setMessage(t("room.proxySet"));
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
        setMessage(t("room.negotiationUpdated"));
        await live.refetchSnapshot();
      } catch (err) {
        setMessage(formatError(err));
      }
    });
  }

  function toggleWatch(): void {
    if (!isBuyer) return;
    startTransition(async () => {
      try {
        if (watching) {
          await apiFetch(`/auctions/${initial.id}/watch`, { method: "DELETE" });
          setWatching(false);
        } else {
          await apiFetch(`/auctions/${initial.id}/watch`, { method: "POST" });
          setWatching(true);
        }
      } catch (err) {
        setMessage(formatError(err));
      }
    });
  }

  const image = initial.images[0];
  const bidDisabled =
    pending ||
    !canBid ||
    inCooldown ||
    !amountValid ||
    (preview != null && (!preview.meetsMinimum || preview.insufficientFunds));

  const pingText = latencyLabel(live.connected, live.latencyMs, live.connectionQuality, t);
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

  const endedLabel = t("common.ended");

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
        title={t("room.connectionLatency")}
      >
        {pingText}
      </div>

      <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col justify-end">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={status} />
            {isBuyer ? (
              <button
                type="button"
                disabled={pending}
                onClick={toggleWatch}
                className="border border-white/20 px-2 py-0.5 text-xs text-mist-200 hover:border-brass-500/50 disabled:opacity-60"
              >
                {watching ? t("room.watchRemove") : t("room.watchAdd")}
              </button>
            ) : null}
          </div>
          <h1 className="mt-3 font-display text-5xl text-mist-50 md:text-6xl">{initial.title}</h1>
          <p className="mt-4 max-w-xl text-mist-300">{initial.description}</p>
        </div>

        <div
          className={`border bg-ink-900/85 p-6 backdrop-blur transition ${
            live.outbidFlash
              ? "border-red-400/70 shadow-[0_0_40px_rgba(248,113,113,0.25)]"
              : "border-white/10"
          }`}
        >
          {live.outbidFlash ? (
            <p className="mb-3 text-sm font-semibold text-red-300">{t("room.outbid")}</p>
          ) : null}
          {live.extendedFlash ? (
            <p className="mb-3 text-sm font-semibold text-brass-400">{t("room.extended")}</p>
          ) : null}
          {isWinning ? (
            <p className="mb-3 text-sm font-semibold text-emerald-300">{t("room.winning")}</p>
          ) : null}

          {settled ? (
            <div className="mb-4 border border-emerald-500/30 bg-ink-950/50 p-4 text-sm text-mist-200">
              <p className="font-semibold text-emerald-300">{t("room.settledTitle")}</p>
              <p className="mt-1">
                {t("room.settledPrice")} {formatTry(currentBid)}
                {isHighBidder ? t("room.settledYouWon") : null}
              </p>
            </div>
          ) : ended && !negotiating ? (
            <div className="mb-4 border border-white/15 bg-ink-950/50 p-4 text-sm text-mist-200">
              <p className="font-semibold text-mist-100">{t("room.endedTitle")}</p>
              <p className="mt-1">
                {t("room.lastBid")} {formatTry(currentBid || initial.startingPrice)}
              </p>
            </div>
          ) : null}

          <p className="text-sm text-mist-300">{t("room.currentBid")}</p>
          <p className="font-display text-5xl text-brass-400 transition-all">
            {formatTry(currentBid || initial.startingPrice)}
          </p>
          <p className="mt-4 text-sm text-mist-300">
            {negotiating ? t("room.negotiationTime") : t("room.timeRemaining")}
          </p>
          <p className="font-mono text-3xl tabular-nums text-mist-50">
            {negotiating && negotiationExpiresAt
              ? formatCountdown(negotiationExpiresAt, now, endedLabel)
              : formatCountdown(endsAt, now, endedLabel)}
          </p>

          {wallet ? (
            <div className="mt-4 grid grid-cols-2 gap-2 border border-white/10 bg-ink-950/40 px-3 py-2 text-xs text-mist-300">
              <p>
                {t("room.available")}{" "}
                <span className="text-brass-400">{formatTry(wallet.availableBalance)}</span>
              </p>
              <p>
                {t("room.held")}{" "}
                <span className="text-mist-100">{formatTry(wallet.heldBalance)}</span>
              </p>
            </div>
          ) : null}

          {negotiating ? (
            <div className="mt-6 space-y-3 border border-brass-500/40 bg-ink-950/60 p-4 text-sm text-mist-200">
              <p className="font-semibold text-brass-400">{t("room.negotiationTitle")}</p>
              <p>
                {t("room.negotiationBody", {
                  bid: formatTry(currentBid),
                  when: negotiationExpiresAt
                    ? new Date(negotiationExpiresAt).toLocaleString(bcp47)
                    : t("room.soon"),
                })}
              </p>
              {counterOfferCents != null ? (
                <p>
                  {t("room.sellerCounter")} {formatTry(counterOfferCents)}
                </p>
              ) : (
                <p>{t("room.noCounter")}</p>
              )}

              {isSellerHere || user?.roles?.includes("ADMIN") ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      className="bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 disabled:opacity-60"
                      onClick={() =>
                        runNegotiation(`/auctions/${initial.id}/negotiation/accept`)
                      }
                    >
                      {t("room.acceptHigh")}
                    </button>
                    <button
                      type="button"
                      disabled={pending || counterCents == null}
                      className="border border-white/20 px-3 py-1.5 text-xs disabled:opacity-60"
                      onClick={() => {
                        if (counterCents == null) return;
                        runNegotiation(`/auctions/${initial.id}/negotiation/counter`, {
                          amountCents: counterCents,
                        });
                      }}
                    >
                      {t("room.sendCounter")}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      className="border border-red-400/40 px-3 py-1.5 text-xs text-red-300 disabled:opacity-60"
                      onClick={() =>
                        runNegotiation(`/auctions/${initial.id}/negotiation/decline`)
                      }
                    >
                      {t("room.decline")}
                    </button>
                  </div>
                  <MoneyInput
                    label={t("room.counterAmount")}
                    valueCents={counterCents}
                    onChangeCents={setCounterCents}
                    disabled={pending}
                  />
                </div>
              ) : null}

              {isHighBidder ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || counterOfferCents == null}
                    className="border border-brass-500/50 px-3 py-1.5 text-xs text-brass-400 disabled:opacity-60"
                    onClick={() =>
                      runNegotiation(`/auctions/${initial.id}/negotiation/accept-counter`)
                    }
                  >
                    {t("room.acceptCounter")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="border border-red-400/40 px-3 py-1.5 text-xs text-red-300 disabled:opacity-60"
                    onClick={() =>
                      runNegotiation(`/auctions/${initial.id}/negotiation/decline`)
                    }
                  >
                    {t("room.decline")}
                  </button>
                </div>
              ) : null}

              {!user ? (
                <p className="text-mist-300">
                  {t("room.loginToNegotiate")}{" "}
                  <Link href="/login" className="text-brass-400 hover:underline">
                    {t("room.loginLink")}
                  </Link>
                </p>
              ) : !isSellerHere && !isHighBidder && !user.roles.includes("ADMIN") ? (
                <p className="text-mist-300">{t("room.negotiationSpectator")}</p>
              ) : null}
            </div>
          ) : null}

          {!negotiating && !ended ? (
            <>
              {canBid ? (
                <>
                  <MoneyInput
                    className="mt-6"
                    label={t("room.yourBid")}
                    valueCents={amountCents}
                    onChangeCents={setAmountCents}
                    disabled={pending || inCooldown}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="border border-white/15 px-2 py-1 text-xs text-mist-200 hover:border-brass-500/40"
                      onClick={() =>
                        setAmountCents(
                          currentBid > 0
                            ? currentBid + initial.minIncrement
                            : initial.startingPrice,
                        )
                      }
                    >
                      {t("room.quickMin", { amount: formatTry(initial.minIncrement) })}
                    </button>
                    <button
                      type="button"
                      className="border border-white/15 px-2 py-1 text-xs text-mist-200 hover:border-brass-500/40"
                      onClick={() =>
                        setAmountCents(
                          (currentBid > 0 ? currentBid : initial.startingPrice) +
                            initial.minIncrement * 2,
                        )
                      }
                    >
                      {t("room.quickDouble")}
                    </button>
                  </div>

                  {preview ? (
                    <div className="mt-3 space-y-1 border border-white/10 bg-ink-950/50 px-3 py-2 text-xs text-mist-300">
                      <p>
                        {preview.insufficientFunds ? (
                          <span className="text-red-300">
                            {t("room.insufficientFunds", {
                              need: formatTry(preview.holdDeltaCents),
                              have: formatTry(preview.availableBalanceCents),
                            })}
                          </span>
                        ) : (
                          t("room.willHold", { amount: formatTry(preview.holdDeltaCents) })
                        )}
                      </p>
                      <p>
                        {!preview.meetsMinimum ? (
                          <span className="text-red-300">
                            {t("room.belowMin", { amount: formatTry(preview.minRequiredCents) })}
                          </span>
                        ) : preview.becomesLeader ? (
                          t("room.becomesLeader")
                        ) : (
                          t("room.notLeader")
                        )}
                      </p>
                      {preview.wouldExtend ? (
                        <p className="text-brass-400">
                          {t("room.antiSnipe", {
                            time: preview.extendedEndsAt
                              ? new Date(preview.extendedEndsAt).toLocaleTimeString(bcp47)
                              : "—",
                          })}
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
                    {pending
                      ? t("room.placing")
                      : inCooldown
                        ? t("room.waitSec", { sec: cooldownRemainingSec })
                        : t("room.placeBid")}
                  </button>

                  <MoneyInput
                    className="mt-5"
                    label={t("room.proxyMax")}
                    valueCents={proxyMaxCents}
                    onChangeCents={setProxyMaxCents}
                    disabled={pending || inCooldown}
                  />
                  {myProxyMax != null ? (
                    <p className="mt-1 text-xs text-mist-300">
                      {t("room.currentProxy", { amount: formatTry(myProxyMax) })}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending || inCooldown || proxyMaxCents == null}
                    onClick={setProxy}
                    className="mt-3 w-full border border-white/20 py-2.5 text-sm text-mist-100 hover:border-brass-500/60 disabled:opacity-60"
                  >
                    {t("room.setProxy")}
                  </button>
                </>
              ) : !user ? (
                <p className="mt-6 text-sm text-mist-300">
                  {t("room.loginToBid")}{" "}
                  <Link href="/login" className="text-brass-400 hover:underline">
                    {t("room.loginLink")}
                  </Link>
                </p>
              ) : isSellerHere ? (
                <p className="mt-6 text-sm text-mist-300">{t("room.cannotBidOwn")}</p>
              ) : (
                <p className="mt-6 text-sm text-mist-300">{t("room.buyerRequired")}</p>
              )}
              {message ? (
                <p className={`mt-4 text-sm ${inCooldown ? "text-red-300" : "text-brass-400"}`}>
                  {message}
                </p>
              ) : null}
            </>
          ) : message ? (
            <p className="mt-4 text-sm text-brass-400">{message}</p>
          ) : null}

          <div className="mt-8 border-t border-white/10 pt-4">
            <p className="text-sm text-mist-300">{t("room.bidHistory")}</p>
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
              {live.liveBids.slice(0, 20).map((b) => (
                <li key={b.id} className="flex justify-between text-mist-100">
                  <span className="truncate text-mist-300">
                    {maskBidderId(b.bidderId)}
                    {b.isProxy ? t("room.proxyTag") : ""}
                    {user && b.bidderId === user.id ? t("room.youTag") : ""}
                  </span>
                  <span className="tabular-nums text-brass-400">{formatTry(b.amount)}</span>
                </li>
              ))}
              {live.liveBids.length === 0 ? (
                <li className="text-mist-300">{t("room.noBids")}</li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

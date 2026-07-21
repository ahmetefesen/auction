"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { AuctionDto } from "@auction/shared";
import { API_URL, apiFetch } from "@/lib/api";
import { useT, useLocale, localeToBcp47 } from "@/lib/i18n";
import { useFormatApiError } from "@/lib/use-format-api-error";
import { formatTry } from "@/lib/format";
import { Countdown } from "@/components/ui/Countdown";
import { StatusBadge } from "@/components/ui/StatusBadge";

type FilterStatus = "LIVE" | "SCHEDULED" | "NEGOTIATING" | "all";

const POLL_MS = 12_000;

export function AuctionList() {
  const t = useT();
  const { locale } = useLocale();
  const formatError = useFormatApiError();
  const [filter, setFilter] = useState<FilterStatus>("LIVE");
  const [items, setItems] = useState<AuctionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filters: Array<{ id: FilterStatus; label: string }> = [
    { id: "LIVE", label: t("auctions.filterLive") },
    { id: "SCHEDULED", label: t("auctions.filterScheduled") },
    { id: "NEGOTIATING", label: t("auctions.filterNegotiating") },
    { id: "all", label: t("auctions.filterAll") },
  ];

  const load = useCallback(
    (status: FilterStatus): void => {
      startTransition(async () => {
        try {
          const qs =
            status === "all" ? "pageSize=50" : `status=${status}&pageSize=50`;
          const res = await apiFetch<{ items: AuctionDto[] }>(`/auctions?${qs}`);
          setItems(res.items);
          setError(null);
        } catch (err) {
          setError(formatError(err));
        }
      });
    },
    [formatError],
  );

  useEffect(() => {
    load(filter);
    const id = window.setInterval(() => load(filter), POLL_MS);
    return () => window.clearInterval(id);
  }, [filter, load]);

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`border px-3 py-1.5 text-sm ${
              filter === f.id
                ? "border-brass-500/60 text-brass-400"
                : "border-white/15 text-mist-300 hover:border-white/30"
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => load(filter)}
          className="ml-auto text-sm text-brass-400 hover:underline disabled:opacity-60"
        >
          {t("auctions.refresh")}
        </button>
      </div>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {items.length === 0 && !error ? (
          <p className="text-mist-300">{t("auctions.empty")}</p>
        ) : (
          items.map((auction) => {
            const showCountdown =
              auction.status === "LIVE" || auction.status === "NEGOTIATING";
            const endsIso =
              auction.status === "NEGOTIATING" && auction.negotiationExpiresAt
                ? auction.negotiationExpiresAt
                : auction.endsAt;
            return (
              <Link
                key={auction.id}
                href={`/auctions/${auction.id}`}
                className="group block border-b border-white/10 pb-6 transition hover:border-brass-500/50"
              >
                <div className="aspect-[16/9] overflow-hidden bg-ink-800">
                  {auction.images[0] ? (
                    <img
                      src={`${API_URL}${auction.images[0].url}`}
                      alt=""
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-mist-300/40">
                      {t("auctions.noImage")}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <StatusBadge status={auction.status} />
                  {showCountdown ? (
                    <Countdown endsAtIso={endsIso} className="text-sm text-mist-100" />
                  ) : auction.status === "SCHEDULED" ? (
                    <span className="text-xs text-mist-300">
                      {t("auctions.startsAt")}{" "}
                      {new Date(auction.startsAt).toLocaleString(localeToBcp47(locale))}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 font-display text-2xl text-mist-50">{auction.title}</h2>
                <p className="mt-1 text-brass-400">
                  {auction.currentBid > 0
                    ? formatTry(auction.currentBid)
                    : formatTry(auction.startingPrice)}
                </p>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { apiFetch, API_URL } from "@/lib/api";
import { useSession } from "@/lib/auth/session";
import { formatTry } from "@/lib/format";
import { useT, useLocale, localeToBcp47 } from "@/lib/i18n";
import { useFormatApiError } from "@/lib/use-format-api-error";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Countdown } from "@/components/ui/Countdown";

type WatchItem = {
  auctionId: string;
  title: string;
  status: string;
  currentBid: number;
  endsAt: string;
  imageUrl: string | null;
};

export default function WatchlistPage() {
  const t = useT();
  const { locale } = useLocale();
  const formatError = useFormatApiError();
  const bcp47 = localeToBcp47(locale);
  const { loaded, isBuyer } = useSession();
  const [items, setItems] = useState<WatchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load(): void {
    startTransition(async () => {
      try {
        const res = await apiFetch<{ items: WatchItem[] }>("/me/watchlist");
        setItems(res.items);
        setError(null);
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  useEffect(() => {
    if (!loaded || !isBuyer) return;
    load();
  }, [loaded, isBuyer]);

  function unwatch(auctionId: string): void {
    startTransition(async () => {
      try {
        await apiFetch(`/auctions/${auctionId}/watch`, { method: "DELETE" });
        setItems((prev) => prev.filter((i) => i.auctionId !== auctionId));
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  if (loaded && !isBuyer) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-4xl text-mist-50">{t("watchlist.title")}</h1>
        <p className="mt-4 text-mist-300">
          {t("watchlist.buyerOnly")}{" "}
          <Link href="/login" className="text-brass-400 hover:underline">
            {t("watchlist.signIn")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-4xl text-mist-50">{t("watchlist.title")}</h1>
      <p className="mt-2 text-mist-300">{t("watchlist.subtitle")}</p>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}
      <ul className="mt-10 space-y-4">
        {items.map((item) => (
          <li
            key={item.auctionId}
            className="flex flex-wrap items-center gap-4 border-b border-white/10 pb-4"
          >
            <div className="h-16 w-24 shrink-0 overflow-hidden bg-ink-800">
              {item.imageUrl ? (
                <img
                  src={`${API_URL}${item.imageUrl}`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/auctions/${item.auctionId}`}
                  className="truncate text-mist-50 hover:text-brass-400"
                >
                  {item.title}
                </Link>
                <StatusBadge status={item.status} />
              </div>
              <p className="mt-1 text-sm text-mist-300">
                {formatTry(item.currentBid)} ·{" "}
                {item.status === "LIVE" || item.status === "NEGOTIATING" ? (
                  <Countdown endsAtIso={item.endsAt} className="text-mist-100" />
                ) : (
                  new Date(item.endsAt).toLocaleString(bcp47)
                )}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => unwatch(item.auctionId)}
              className="text-sm text-mist-300 hover:text-red-300 disabled:opacity-60"
            >
              {t("watchlist.remove")}
            </button>
          </li>
        ))}
        {items.length === 0 && !error ? (
          <li className="text-mist-300">
            {t("watchlist.empty")}{" "}
            <Link href="/auctions" className="text-brass-400 hover:underline">
              {t("watchlist.browse")}
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { AuctionDto } from "@auction/shared";
import { API_URL, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth/session";
import { formatTry } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useFormatApiError } from "@/lib/use-format-api-error";
import { useSellerLive } from "@/lib/use-seller-live";
import { FlashBanner } from "@/components/FlashBanner";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { StatusBadge } from "@/components/ui/StatusBadge";

type WinnerInsights = {
  winner: { id: string; displayName: string; emailMasked: string };
  trustScore: number;
  purchases: Array<{ auctionId: string; title: string; amountCents: number; settledAt: string }>;
};

export default function SellerPage() {
  const t = useT();
  const formatError = useFormatApiError();
  const { loaded, isSeller, user } = useSession();
  const [items, setItems] = useState<AuctionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [insights, setInsights] = useState<WinnerInsights | null>(null);
  const [insightsTitle, setInsightsTitle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startingPrice, setStartingPrice] = useState<number | null>(10_000);
  const [minIncrement, setMinIncrement] = useState<number | null>(500);
  const [reservePrice, setReservePrice] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState("24");
  const [imageFile, setImageFile] = useState<File | null>(null);

  function load(): void {
    startTransition(async () => {
      try {
        const res = await apiFetch<{ items: AuctionDto[] }>("/me/auctions");
        setItems(res.items);
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  useEffect(() => {
    if (!loaded || !isSeller) return;
    load();
  }, [loaded, isSeller]);

  const onLiveBid = useCallback(
    (update: {
      auctionId: string;
      currentBidCents: number;
      currentWinnerId: string | null;
      endsAt: string;
    }) => {
      setItems((prev) =>
        prev.map((a) =>
          a.id === update.auctionId
            ? {
                ...a,
                currentBid: update.currentBidCents,
                currentWinnerId: update.currentWinnerId,
                endsAt: update.endsAt,
              }
            : a,
        ),
      );
    },
    [],
  );

  useSellerLive(isSeller && user ? user.id : null, onLiveBid);

  if (loaded && !isSeller) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-4xl text-mist-50">{t("seller.title")}</h1>
        <p className="mt-4 text-mist-300">
          {t("seller.sellerOnly")}{" "}
          <Link href="/login" className="text-brass-400 hover:underline">
            {t("seller.signIn")}
          </Link>
        </p>
      </div>
    );
  }

  async function uploadImage(auctionId: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_URL}/auctions/${auctionId}/images`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const msg =
        body &&
        typeof body === "object" &&
        "error" in body &&
        body.error &&
        typeof body.error === "object" &&
        "message" in body.error &&
        typeof body.error.message === "string"
          ? body.error.message
          : t("seller.imageFailed");
      throw new Error(msg);
    }
  }

  function createAuction(publish: boolean): void {
    startTransition(async () => {
      setError(null);
      setSuccess(null);
      const trimmedTitle = title.trim();
      const d = description.trim();
      const hours = Number.parseInt(durationHours, 10);
      if (trimmedTitle.length < 3) {
        setError(t("seller.titleMin"));
        return;
      }
      if (!d) {
        setError(t("seller.descriptionRequired"));
        return;
      }
      if (startingPrice == null || startingPrice <= 0) {
        setError(t("seller.startingRequired"));
        return;
      }
      if (minIncrement == null || minIncrement <= 0) {
        setError(t("seller.incrementRequired"));
        return;
      }
      if (!Number.isFinite(hours) || hours <= 0) {
        setError(t("seller.durationRequired"));
        return;
      }
      if (reservePrice != null && reservePrice < startingPrice) {
        setError(t("seller.reserveLow"));
        return;
      }
      try {
        const startsAt = new Date().toISOString();
        const endsAt = new Date(Date.now() + hours * 3600_000).toISOString();
        const body: Record<string, unknown> = {
          title: trimmedTitle,
          description: d,
          startingPrice,
          minIncrement,
          startsAt,
          endsAt,
        };
        if (reservePrice != null && reservePrice > 0) {
          body.reservePrice = reservePrice;
        }
        const created = await apiFetch<{ auction: AuctionDto }>("/auctions", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (imageFile) {
          await uploadImage(created.auction.id, imageFile);
        }
        if (publish) {
          await apiFetch(`/auctions/${created.auction.id}/publish`, { method: "POST" });
          setSuccess(t("seller.published", { title: created.auction.title }));
        } else {
          setSuccess(t("seller.draftSaved", { title: created.auction.title }));
        }
        setTitle("");
        setDescription("");
        setReservePrice(null);
        setImageFile(null);
        load();
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  function publishDraft(auction: AuctionDto): void {
    startTransition(async () => {
      try {
        await apiFetch(`/auctions/${auction.id}/publish`, { method: "POST" });
        setSuccess(t("seller.published", { title: auction.title }));
        load();
      } catch (err) {
        setError(formatError(err));
      }
    });
  }

  function cancelLot(auction: AuctionDto): void {
    if (!window.confirm(t("seller.cancelConfirm", { title: auction.title }))) return;
    startTransition(async () => {
      try {
        await apiFetch(`/auctions/${auction.id}/cancel`, { method: "POST" });
        setSuccess(t("seller.cancelled", { title: auction.title }));
        load();
      } catch (err) {
        setError(formatError(err));
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
        setError(formatError(err));
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <FlashBanner />
      <h1 className="font-display text-4xl text-mist-50">{t("seller.title")}</h1>
      <p className="mt-2 text-mist-300">{t("seller.subtitle")}</p>
      {error ? <p className="mt-4 text-red-300">{error}</p> : null}
      {success ? <p className="mt-4 text-brass-300">{success}</p> : null}
      <div className="mt-8 space-y-3">
        <input
          className="w-full border border-white/15 bg-ink-900 px-3 py-2 text-mist-50"
          placeholder={t("seller.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full border border-white/15 bg-ink-900 px-3 py-2 text-mist-50"
          placeholder={t("seller.descriptionPlaceholder")}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput
            label={t("seller.startingPrice")}
            valueCents={startingPrice}
            onChangeCents={setStartingPrice}
            disabled={pending}
          />
          <MoneyInput
            label={t("seller.minIncrement")}
            valueCents={minIncrement}
            onChangeCents={setMinIncrement}
            disabled={pending}
          />
          <MoneyInput
            label={t("seller.reservePrice")}
            valueCents={reservePrice}
            onChangeCents={setReservePrice}
            disabled={pending}
          />
          <label className="block text-sm text-mist-300">
            {t("seller.durationHours")}
            <input
              className="mt-1 w-full border border-white/15 bg-ink-950 px-3 py-2 text-mist-50"
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              disabled={pending}
            />
          </label>
        </div>
        <label className="block text-sm text-mist-300">
          {t("seller.image")}
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full text-sm text-mist-300 file:mr-3 file:border file:border-white/20 file:bg-ink-900 file:px-3 file:py-1.5 file:text-mist-100"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            disabled={pending}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => createAuction(false)}
            className="border border-white/20 px-4 py-2 text-sm text-mist-100 disabled:opacity-60"
          >
            {t("seller.saveDraft")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => createAuction(true)}
            className="bg-brass-500 px-4 py-2 font-semibold text-ink-950 disabled:opacity-60"
          >
            {t("seller.savePublish")}
          </button>
        </div>
      </div>
      <ul className="mt-12 space-y-3">
        {items.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 py-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/auctions/${a.id}`} className="text-mist-50 hover:text-brass-400">
                  {a.title}
                </Link>
                <StatusBadge status={a.status} />
              </div>
              <p className="text-sm text-mist-300">
                {formatTry(a.currentBid || a.startingPrice)}
                {a.reservePrice != null
                  ? t("seller.reserveLabel", { amount: formatTry(a.reservePrice) })
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {a.status === "DRAFT" || a.status === "SCHEDULED" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => publishDraft(a)}
                  className="text-sm text-brass-400 hover:underline disabled:opacity-60"
                >
                  {t("seller.publish")}
                </button>
              ) : null}
              {a.status === "DRAFT" ||
              a.status === "SCHEDULED" ||
              a.status === "LIVE" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => cancelLot(a)}
                  className="text-sm text-red-300 hover:underline disabled:opacity-60"
                >
                  {t("seller.cancel")}
                </button>
              ) : null}
              {a.status === "SETTLED" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => openInsights(a)}
                  className="text-sm text-brass-400 hover:underline disabled:opacity-60"
                >
                  {t("seller.winnerInsights")}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {insights ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg border border-white/15 bg-ink-900 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-brass-400">
                  {t("seller.winnerInsights")}
                </p>
                <h2 className="font-display text-2xl text-mist-50">{insightsTitle}</h2>
              </div>
              <button
                type="button"
                className="text-mist-300 hover:text-mist-50"
                onClick={() => setInsights(null)}
              >
                {t("seller.close")}
              </button>
            </div>
            <p className="mt-4 text-mist-100">
              {insights.winner.displayName} · {insights.winner.emailMasked}
            </p>
            <p className="mt-2 text-sm text-mist-300">
              {t("seller.trustScore")}{" "}
              <span className="text-brass-400">{insights.trustScore}/100</span>
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

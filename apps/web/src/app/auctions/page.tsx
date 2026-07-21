"use client";

import { FlashBanner } from "@/components/FlashBanner";
import { AuctionList } from "@/components/AuctionList";
import { useT } from "@/lib/i18n";

export default function AuctionsPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <FlashBanner />
      <h1 className="font-display text-4xl text-mist-50">{t("auctions.title")}</h1>
      <p className="mt-2 text-mist-300">{t("auctions.subtitle")}</p>
      <AuctionList />
    </div>
  );
}

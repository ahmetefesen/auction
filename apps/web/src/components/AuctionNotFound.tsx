"use client";

import { useT } from "@/lib/i18n";

export function AuctionNotFound() {
  const t = useT();
  return (
    <div className="mx-auto max-w-6xl px-6 py-20 text-mist-300">{t("auctions.notFound")}</div>
  );
}

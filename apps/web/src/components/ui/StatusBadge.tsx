"use client";

import type { AuctionStatus } from "@auction/shared";
import { useT } from "@/lib/i18n";

const STATUS_CLASS: Record<string, string> = {
  DRAFT: "text-mist-300 border-white/20",
  SCHEDULED: "text-brass-300 border-brass-500/40",
  LIVE: "text-emerald-300 border-emerald-500/40",
  NEGOTIATING: "text-brass-400 border-brass-500/50",
  ENDED: "text-mist-300 border-white/15",
  CANCELLED: "text-red-300 border-red-400/40",
  SETTLED: "text-emerald-200 border-emerald-400/30",
};

export function StatusBadge({ status }: { status: AuctionStatus | string }) {
  const t = useT();
  const tone = STATUS_CLASS[status] ?? "text-mist-300 border-white/15";
  const label = t(`status.${status}`) !== `status.${status}` ? t(`status.${status}`) : status;
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-xs uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

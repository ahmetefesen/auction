"use client";

import { formatCountdown } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useSyncedNow } from "@/lib/use-auction-socket";

export function Countdown({
  endsAtIso,
  serverOffsetMs = 0,
  className = "",
}: {
  endsAtIso: string;
  serverOffsetMs?: number;
  className?: string;
}) {
  const t = useT();
  const now = useSyncedNow(serverOffsetMs);
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {formatCountdown(endsAtIso, now, t("common.ended"))}
    </span>
  );
}

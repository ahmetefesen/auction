import { formatMoney } from "@auction/shared";

const CURRENCY = "TRY";

export function formatTry(cents: number): string {
  return formatMoney(cents, CURRENCY);
}

export function formatCountdown(endsAtIso: string, nowMs: number): string {
  const diff = new Date(endsAtIso).getTime() - nowMs;
  if (diff <= 0) return "Ended";
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

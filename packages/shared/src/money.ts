import { z } from "zod";

/** Integer minor units (cents/kuruş). Never use floating point for money. */
export const moneyCentsBrandSchema = z
  .number()
  .int("Money must be an integer minor-unit amount")
  .nonnegative()
  .brand<"MoneyCents">();

export type MoneyCents = z.infer<typeof moneyCentsBrandSchema>;

export function toMoneyCents(value: number): MoneyCents {
  return moneyCentsBrandSchema.parse(value);
}

export function assertPositiveMoney(value: MoneyCents): void {
  if (value <= 0) {
    throw new Error("Money must be positive");
  }
}

export function formatMoney(cents: number, currency: string): string {
  const major = Math.trunc(cents / 100);
  const minor = Math.abs(cents % 100)
    .toString()
    .padStart(2, "0");
  return `${major}.${minor} ${currency}`;
}

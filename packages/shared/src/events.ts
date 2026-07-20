import { z } from "zod";

export const RealtimeEvent = {
  BID_PLACED: "bid.placed",
  AUCTION_EXTENDED: "auction.extended",
  AUCTION_ENDED: "auction.ended",
  AUCTION_SETTLED: "auction.settled",
  AUCTION_NEGOTIATING: "auction.negotiating",
  WALLET_UPDATED: "wallet.updated",
} as const;

export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export const bidPlacedPayloadSchema = z.object({
  auctionId: z.string().uuid(),
  bidId: z.string().uuid(),
  bidderId: z.string().uuid(),
  amountCents: z.number().int().nonnegative(),
  currentBidCents: z.number().int().nonnegative(),
  currentWinnerId: z.string().uuid().nullable(),
  endsAt: z.string().datetime(),
  isProxy: z.boolean(),
});

export type BidPlacedPayload = z.infer<typeof bidPlacedPayloadSchema>;

export const auctionExtendedPayloadSchema = z.object({
  auctionId: z.string().uuid(),
  endsAt: z.string().datetime(),
  extendedBySec: z.number().int().positive(),
});

export type AuctionExtendedPayload = z.infer<typeof auctionExtendedPayloadSchema>;

export const auctionEndedPayloadSchema = z.object({
  auctionId: z.string().uuid(),
  winnerId: z.string().uuid().nullable(),
  finalBidCents: z.number().int().nonnegative(),
});

export type AuctionEndedPayload = z.infer<typeof auctionEndedPayloadSchema>;

export const auctionNegotiatingPayloadSchema = z.object({
  auctionId: z.string().uuid(),
  currentBidCents: z.number().int().nonnegative(),
  currentWinnerId: z.string().uuid(),
  negotiationExpiresAt: z.string().datetime(),
  counterOfferCents: z.number().int().positive().nullable(),
});

export type AuctionNegotiatingPayload = z.infer<typeof auctionNegotiatingPayloadSchema>;

export const auctionSettledPayloadSchema = z.object({
  auctionId: z.string().uuid(),
  winnerId: z.string().uuid().nullable(),
  amountCents: z.number().int().nonnegative(),
});

export type AuctionSettledPayload = z.infer<typeof auctionSettledPayloadSchema>;

export const walletUpdatedPayloadSchema = z.object({
  userId: z.string().uuid(),
  availableBalance: z.number().int().nonnegative(),
  heldBalance: z.number().int().nonnegative(),
});

export type WalletUpdatedPayload = z.infer<typeof walletUpdatedPayloadSchema>;

export function auctionRoom(auctionId: string): string {
  return `auction:${auctionId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

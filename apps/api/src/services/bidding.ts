import {
  prisma,
  AuctionStatus,
  Prisma,
  lockAuctionById,
  lockWalletsByUserIds,
  lockProxyBidsForAuction,
  type LockedAuction,
  type LockedProxyBid,
} from "@auction/db";
import { RealtimeEvent } from "@auction/shared";
import { AppError } from "../lib/errors.js";
import { walletService } from "./wallet.js";
import type { EventBus } from "../realtime/event-bus.js";
import type { EmailQueue } from "../queues/email.js";

export type PlaceBidResult = {
  auction: LockedAuction;
  bidId: string;
  extended: boolean;
  previousWinnerId: string | null;
  affectedUserIds: string[];
};

function minimumNextBid(auction: LockedAuction): number {
  if (auction.currentBid <= 0) {
    return auction.startingPrice;
  }
  return auction.currentBid + auction.minIncrement;
}

/**
 * Classic proxy: visible bid = min(winnerMax, max(floor, secondMax + increment)).
 * Competing proxy with max >= incoming+increment can override to win at counter price.
 */
function resolveProxyOutcome(input: {
  auction: LockedAuction;
  incomingBidderId: string;
  incomingMax: number;
  proxies: readonly LockedProxyBid[];
}): {
  winnerId: string;
  visibleBid: number;
  bidsToRecord: Array<{ bidderId: string; amount: number; isProxy: boolean }>;
} {
  const byBidder = new Map<string, number>();
  for (const p of input.proxies) {
    byBidder.set(p.bidderId, Math.max(byBidder.get(p.bidderId) ?? 0, p.maxAmount));
  }
  byBidder.set(
    input.incomingBidderId,
    Math.max(byBidder.get(input.incomingBidderId) ?? 0, input.incomingMax),
  );

  const entries = [...byBidder.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (a[0] === input.auction.currentWinnerId) return -1;
    if (b[0] === input.auction.currentWinnerId) return 1;
    if (a[0] === input.incomingBidderId) return -1;
    if (b[0] === input.incomingBidderId) return 1;
    return a[0].localeCompare(b[0]);
  });

  const top = entries[0];
  if (!top) {
    throw new AppError(400, "NO_BIDDERS", "No bidders available");
  }
  const second = entries[1];
  const winnerId = top[0];
  const winnerMax = top[1];
  const floor = minimumNextBid(input.auction);
  const secondMax = second ? second[1] : 0;
  const visibleFromSecond = secondMax > 0 ? secondMax + input.auction.minIncrement : floor;
  const visibleBid = Math.min(winnerMax, Math.max(floor, visibleFromSecond));

  const bidsToRecord: Array<{ bidderId: string; amount: number; isProxy: boolean }> = [];
  if (visibleBid > input.auction.currentBid || winnerId !== input.auction.currentWinnerId) {
    const isManualExact =
      winnerId === input.incomingBidderId && input.incomingMax === visibleBid;
    bidsToRecord.push({
      bidderId: winnerId,
      amount: visibleBid,
      isProxy: !isManualExact,
    });
  }

  return { winnerId, visibleBid, bidsToRecord };
}

async function applyHoldTransition(
  tx: Parameters<typeof walletService.holdForBidInTx>[0],
  auctionId: string,
  previousWinnerId: string | null,
  previousAmount: number,
  newWinnerId: string,
  newAmount: number,
): Promise<void> {
  const userIds = [newWinnerId, ...(previousWinnerId ? [previousWinnerId] : [])];
  await lockWalletsByUserIds(tx, userIds);

  if (previousWinnerId && previousWinnerId !== newWinnerId && previousAmount > 0) {
    await walletService.releaseHoldInTx(tx, previousWinnerId, auctionId, previousAmount);
  }

  if (previousWinnerId === newWinnerId) {
    const delta = newAmount - previousAmount;
    if (delta > 0) {
      await walletService.holdForBidInTx(tx, newWinnerId, auctionId, delta);
    }
    return;
  }

  await walletService.holdForBidInTx(tx, newWinnerId, auctionId, newAmount);
}

async function publishWalletUpdates(eventBus: EventBus, userIds: readonly string[]): Promise<void> {
  const unique = [...new Set(userIds)];
  for (const userId of unique) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) continue;
    await eventBus.publish(RealtimeEvent.WALLET_UPDATED, {
      userId,
      availableBalance: wallet.availableBalance,
      heldBalance: wallet.heldBalance,
    });
  }
}

/**
 * Critical high-concurrency bid path — single Serializable transaction + FOR UPDATE.
 */
export class BiddingService {
  async placeBid(input: {
    auctionId: string;
    bidderId: string;
    amountCents: number;
    idempotencyKey: string | null;
    eventBus: EventBus;
    emailQueue: EmailQueue;
  }): Promise<PlaceBidResult> {
    if (input.idempotencyKey) {
      const existing = await prisma.bidIdempotency.findUnique({
        where: { key_userId: { key: input.idempotencyKey, userId: input.bidderId } },
      });
      if (existing) {
        const auction = await prisma.auction.findUniqueOrThrow({ where: { id: input.auctionId } });
        return {
          auction,
          bidId: existing.bidId,
          extended: false,
          previousWinnerId: auction.currentWinnerId,
          affectedUserIds: [],
        };
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Lock auction
        const auction = await lockAuctionById(tx, input.auctionId);
        if (!auction) {
          throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
        }

        // 2. Validate
        if (auction.status !== AuctionStatus.LIVE) {
          throw new AppError(400, "AUCTION_NOT_LIVE", "Auction is not live");
        }
        if (auction.endsAt.getTime() <= Date.now()) {
          throw new AppError(400, "AUCTION_ENDED", "Auction has ended");
        }
        if (auction.sellerId === input.bidderId) {
          throw new AppError(400, "SELF_BID", "Seller cannot bid on own auction");
        }
        const minRequired = minimumNextBid(auction);
        if (input.amountCents < minRequired) {
          throw new AppError(400, "BID_TOO_LOW", `Minimum bid is ${minRequired} cents`);
        }

        // Proxy max at least this bid
        const existingProxy = await tx.proxyBid.findUnique({
          where: {
            auctionId_bidderId: { auctionId: auction.id, bidderId: input.bidderId },
          },
        });
        const mergedMax = Math.max(existingProxy?.maxAmount ?? 0, input.amountCents);
        await tx.proxyBid.upsert({
          where: {
            auctionId_bidderId: { auctionId: auction.id, bidderId: input.bidderId },
          },
          create: {
            auctionId: auction.id,
            bidderId: input.bidderId,
            maxAmount: mergedMax,
          },
          update: { maxAmount: mergedMax },
        });

        // 5. Proxy bidding resolution
        const proxies = await lockProxyBidsForAuction(tx, auction.id);
        const outcome = resolveProxyOutcome({
          auction,
          incomingBidderId: input.bidderId,
          incomingMax: input.amountCents,
          proxies: proxies.map((p) =>
            p.bidderId === input.bidderId ? { ...p, maxAmount: mergedMax } : p,
          ),
        });

        // 3. Anti-sniping
        let endsAt = auction.endsAt;
        let extended = false;
        const windowMs = auction.antiSnipeWindowSec * 1000;
        if (auction.endsAt.getTime() - Date.now() <= windowMs) {
          endsAt = new Date(auction.endsAt.getTime() + auction.antiSnipeExtendSec * 1000);
          extended = true;
        }

        const previousWinnerId = auction.currentWinnerId;
        const previousAmount = auction.currentBid;

        // 4. Escrow holds
        await applyHoldTransition(
          tx,
          auction.id,
          previousWinnerId,
          previousAmount,
          outcome.winnerId,
          outcome.visibleBid,
        );

        // 6. Insert bid(s) + update auction
        let lastBidId = "";
        for (const b of outcome.bidsToRecord) {
          const created = await tx.bid.create({
            data: {
              auctionId: auction.id,
              bidderId: b.bidderId,
              amount: b.amount,
              isProxy: b.isProxy,
            },
          });
          lastBidId = created.id;
        }
        if (!lastBidId) {
          const created = await tx.bid.create({
            data: {
              auctionId: auction.id,
              bidderId: input.bidderId,
              amount: input.amountCents,
              isProxy: false,
            },
          });
          lastBidId = created.id;
        }

        const updated = await tx.auction.update({
          where: { id: auction.id },
          data: {
            currentBid: outcome.visibleBid,
            currentWinnerId: outcome.winnerId,
            endsAt,
            version: { increment: 1 },
          },
        });

        if (input.idempotencyKey) {
          await tx.bidIdempotency.create({
            data: {
              key: input.idempotencyKey,
              userId: input.bidderId,
              auctionId: auction.id,
              bidId: lastBidId,
            },
          });
        }

        const affectedUserIds = [
          input.bidderId,
          outcome.winnerId,
          ...(previousWinnerId ? [previousWinnerId] : []),
        ];

        return {
          auction: updated,
          bidId: lastBidId,
          extended,
          previousWinnerId,
          affectedUserIds,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );

    // 7. After commit — Redis events
    await input.eventBus.publish(RealtimeEvent.BID_PLACED, {
      auctionId: result.auction.id,
      bidId: result.bidId,
      bidderId: input.bidderId,
      amountCents: result.auction.currentBid,
      currentBidCents: result.auction.currentBid,
      currentWinnerId: result.auction.currentWinnerId,
      endsAt: result.auction.endsAt.toISOString(),
      isProxy: result.auction.currentWinnerId !== input.bidderId,
    });

    if (result.extended) {
      await input.eventBus.publish(RealtimeEvent.AUCTION_EXTENDED, {
        auctionId: result.auction.id,
        endsAt: result.auction.endsAt.toISOString(),
        extendedBySec: result.auction.antiSnipeExtendSec,
      });
    }

    await publishWalletUpdates(input.eventBus, result.affectedUserIds);

    if (
      result.previousWinnerId &&
      result.previousWinnerId !== result.auction.currentWinnerId
    ) {
      await input.emailQueue.addOutbid({
        userId: result.previousWinnerId,
        auctionId: result.auction.id,
        auctionTitle: result.auction.title,
        currentBidCents: result.auction.currentBid,
      });
    }

    return result;
  }

  async setProxyBid(input: {
    auctionId: string;
    bidderId: string;
    maxAmountCents: number;
    eventBus: EventBus;
    emailQueue: EmailQueue;
  }): Promise<PlaceBidResult> {
    return this.placeBid({
      auctionId: input.auctionId,
      bidderId: input.bidderId,
      amountCents: input.maxAmountCents,
      idempotencyKey: null,
      eventBus: input.eventBus,
      emailQueue: input.emailQueue,
    });
  }
}

export const biddingService = new BiddingService();

/** @deprecated Prefer biddingService.placeBid */
export async function placeBid(
  input: Parameters<BiddingService["placeBid"]>[0],
): Promise<PlaceBidResult> {
  return biddingService.placeBid(input);
}

/** @deprecated Prefer biddingService.setProxyBid */
export async function setProxyBid(
  input: Parameters<BiddingService["setProxyBid"]>[0],
): Promise<PlaceBidResult> {
  return biddingService.setProxyBid(input);
}

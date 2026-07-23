import { prisma, AuctionStatus, lockAuctionById, lockWalletsByUserIds, Prisma } from "@auction/db";
import { RealtimeEvent, type AuctionDto, Role as SharedRole, hasRole, type Role } from "@auction/shared";
import { AuctionEventType } from "@auction/db";
import { AppError } from "../lib/errors.js";
import { walletService } from "./wallet.js";
import type { EventBus } from "../realtime/event-bus.js";
import type { EmailQueue } from "../queues/email.js";
import { toDto } from "./auction.js";
import { recordAuctionEvent } from "./auction-events.js";

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 15_000,
};

async function settleNegotiatingAtAmount(
  tx: Prisma.TransactionClient,
  auctionId: string,
  amount: number,
): Promise<{
  auction: Awaited<ReturnType<typeof lockAuctionById>> & object;
  winnerId: string;
  sellerId: string;
  title: string;
  amount: number;
}> {
  const auction = await lockAuctionById(tx, auctionId);
  if (!auction) {
    throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
  }
  if (auction.status !== AuctionStatus.NEGOTIATING) {
    throw new AppError(400, "NOT_NEGOTIATING", "Auction is not in negotiation");
  }
  if (!auction.currentWinnerId || auction.currentBid <= 0) {
    throw new AppError(400, "NO_WINNER", "No high bidder to settle");
  }

  await lockWalletsByUserIds(tx, [auction.currentWinnerId, auction.sellerId]);

  const heldFor = auction.currentBid;
  if (amount > heldFor) {
    await walletService.holdForBidInTx(
      tx,
      auction.currentWinnerId,
      auction.id,
      amount - heldFor,
    );
  }

  await tx.auction.update({
    where: { id: auction.id },
    data: {
      status: AuctionStatus.ENDED,
      currentBid: amount,
      version: { increment: 1 },
    },
  });

  await walletService.captureHoldInTx(
    tx,
    auction.currentWinnerId,
    auction.sellerId,
    auction.id,
    amount,
  );

  const settled = await tx.auction.update({
    where: { id: auction.id },
    data: {
      status: AuctionStatus.SETTLED,
      negotiationExpiresAt: null,
      counterOfferCents: null,
      version: { increment: 1 },
    },
  });

  await recordAuctionEvent(tx, {
    auctionId: auction.id,
    type: AuctionEventType.SETTLED,
    actorUserId: auction.currentWinnerId,
    payload: { amountCents: amount, via: "negotiation" },
    startsAt: auction.startsAt,
  });

  return {
    auction: settled,
    winnerId: auction.currentWinnerId,
    sellerId: auction.sellerId,
    title: auction.title,
    amount,
  };
}

async function publishSettled(
  eventBus: EventBus,
  emailQueue: EmailQueue,
  result: {
    auction: { id: string; title: string; currentBid: number };
    winnerId: string;
    amount: number;
  },
): Promise<void> {
  await eventBus.publish(RealtimeEvent.AUCTION_ENDED, {
    auctionId: result.auction.id,
    winnerId: result.winnerId,
    finalBidCents: result.amount,
  });
  await eventBus.publish(RealtimeEvent.AUCTION_SETTLED, {
    auctionId: result.auction.id,
    winnerId: result.winnerId,
    amountCents: result.amount,
  });
  await emailQueue.addWon({
    userId: result.winnerId,
    auctionId: result.auction.id,
    auctionTitle: result.auction.title,
    amountCents: result.amount,
  });
}

/** Seller accepts the current high bid (below reserve). */
export async function acceptHighBid(input: {
  auctionId: string;
  actorId: string;
  actorRoles: readonly Role[];
  eventBus: EventBus;
  emailQueue: EmailQueue;
}): Promise<AuctionDto> {
  const result = await prisma.$transaction(async (tx) => {
    const auction = await lockAuctionById(tx, input.auctionId);
    if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
    if (auction.status !== AuctionStatus.NEGOTIATING) {
      throw new AppError(400, "NOT_NEGOTIATING", "Auction is not in negotiation");
    }
    if (auction.sellerId !== input.actorId && !hasRole(input.actorRoles, SharedRole.ADMIN)) {
      throw new AppError(403, "FORBIDDEN", "Only the seller can accept the high bid");
    }
    return settleNegotiatingAtAmount(tx, input.auctionId, auction.currentBid);
  }, SERIALIZABLE);

  await publishSettled(input.eventBus, input.emailQueue, result);
  return toDto(result.auction, input.actorRoles);
}

/** Seller proposes a counter-offer (≥ current bid). */
export async function proposeCounterOffer(input: {
  auctionId: string;
  actorId: string;
  actorRoles: readonly Role[];
  amountCents: number;
  eventBus: EventBus;
}): Promise<AuctionDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const auction = await lockAuctionById(tx, input.auctionId);
    if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
    if (auction.status !== AuctionStatus.NEGOTIATING) {
      throw new AppError(400, "NOT_NEGOTIATING", "Auction is not in negotiation");
    }
    if (auction.sellerId !== input.actorId && !hasRole(input.actorRoles, SharedRole.ADMIN)) {
      throw new AppError(403, "FORBIDDEN", "Only the seller can counter");
    }
    if (input.amountCents < auction.currentBid) {
      throw new AppError(400, "COUNTER_TOO_LOW", "Counter must be >= current bid");
    }
    return tx.auction.update({
      where: { id: auction.id },
      data: {
        counterOfferCents: input.amountCents,
        version: { increment: 1 },
      },
      include: { images: true },
    });
  }, SERIALIZABLE);

  await input.eventBus.publish(RealtimeEvent.AUCTION_NEGOTIATING, {
    auctionId: updated.id,
    currentBidCents: updated.currentBid,
    currentWinnerId: updated.currentWinnerId!,
    negotiationExpiresAt: updated.negotiationExpiresAt!.toISOString(),
    counterOfferCents: updated.counterOfferCents,
  });

  return toDto(updated, input.actorRoles);
}

/** High bidder accepts the seller counter-offer. */
export async function acceptCounterOffer(input: {
  auctionId: string;
  actorId: string;
  actorRoles: readonly Role[];
  eventBus: EventBus;
  emailQueue: EmailQueue;
}): Promise<AuctionDto> {
  const result = await prisma.$transaction(async (tx) => {
    const auction = await lockAuctionById(tx, input.auctionId);
    if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
    if (auction.status !== AuctionStatus.NEGOTIATING) {
      throw new AppError(400, "NOT_NEGOTIATING", "Auction is not in negotiation");
    }
    if (!auction.counterOfferCents) {
      throw new AppError(400, "NO_COUNTER", "No counter-offer to accept");
    }
    if (auction.currentWinnerId !== input.actorId && !hasRole(input.actorRoles, SharedRole.ADMIN)) {
      throw new AppError(403, "FORBIDDEN", "Only the high bidder can accept the counter");
    }
    return settleNegotiatingAtAmount(tx, input.auctionId, auction.counterOfferCents);
  }, SERIALIZABLE);

  await publishSettled(input.eventBus, input.emailQueue, result);
  return toDto(result.auction, input.actorRoles);
}

/** Either party declines — release hold and end. */
export async function declineNegotiation(input: {
  auctionId: string;
  actorId: string;
  actorRoles: readonly Role[];
  eventBus: EventBus;
}): Promise<AuctionDto> {
  const ended = await prisma.$transaction(async (tx) => {
    const auction = await lockAuctionById(tx, input.auctionId);
    if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
    if (auction.status !== AuctionStatus.NEGOTIATING) {
      throw new AppError(400, "NOT_NEGOTIATING", "Auction is not in negotiation");
    }
    const isParty =
      auction.sellerId === input.actorId ||
      auction.currentWinnerId === input.actorId ||
      hasRole(input.actorRoles, SharedRole.ADMIN);
    if (!isParty) {
      throw new AppError(403, "FORBIDDEN", "Not a negotiation party");
    }

    if (auction.currentWinnerId && auction.currentBid > 0) {
      await lockWalletsByUserIds(tx, [auction.currentWinnerId]);
      await walletService.releaseHoldInTx(
        tx,
        auction.currentWinnerId,
        auction.id,
        auction.currentBid,
      );
    }

    return tx.auction.update({
      where: { id: auction.id },
      data: {
        status: AuctionStatus.ENDED,
        negotiationExpiresAt: null,
        counterOfferCents: null,
        version: { increment: 1 },
      },
      include: { images: true },
    });
  }, SERIALIZABLE);

  await input.eventBus.publish(RealtimeEvent.AUCTION_ENDED, {
    auctionId: ended.id,
    winnerId: null,
    finalBidCents: ended.currentBid,
  });

  return toDto(ended, input.actorRoles);
}

/** Closer tick: expire negotiation windows past deadline. */
export async function expireNegotiationIfDue(
  auctionId: string,
  eventBus: EventBus,
): Promise<void> {
  const ended = await prisma.$transaction(async (tx) => {
    const auction = await lockAuctionById(tx, auctionId);
    if (!auction) return null;
    if (auction.status !== AuctionStatus.NEGOTIATING) return null;
    if (!auction.negotiationExpiresAt || auction.negotiationExpiresAt.getTime() > Date.now()) {
      return null;
    }

    if (auction.currentWinnerId && auction.currentBid > 0) {
      await lockWalletsByUserIds(tx, [auction.currentWinnerId]);
      await walletService.releaseHoldInTx(
        tx,
        auction.currentWinnerId,
        auction.id,
        auction.currentBid,
      );
    }

    return tx.auction.update({
      where: { id: auction.id },
      data: {
        status: AuctionStatus.ENDED,
        negotiationExpiresAt: null,
        counterOfferCents: null,
        version: { increment: 1 },
      },
    });
  }, SERIALIZABLE);

  if (!ended) return;

  await eventBus.publish(RealtimeEvent.AUCTION_ENDED, {
    auctionId: ended.id,
    winnerId: null,
    finalBidCents: ended.currentBid,
  });
}

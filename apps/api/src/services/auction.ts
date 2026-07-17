import { prisma, AuctionStatus, lockAuctionById, lockWalletsByUserIds } from "@auction/db";
import type { Auction, Role } from "@auction/db";
import {
  AuctionStatus as SharedAuctionStatus,
  type AuctionDto,
  type CreateAuctionInput,
  type UpdateAuctionInput,
  Role as SharedRole,
} from "@auction/shared";
import { AppError } from "../lib/errors.js";
import { walletService } from "./wallet.js";
import type { EventBus } from "../realtime/event-bus.js";
import { RealtimeEvent } from "@auction/shared";
import type { EmailQueue } from "../queues/email.js";

function toDto(
  auction: Auction & { images?: Array<{ id: string; url: string; sortOrder: number }> },
  viewerRole: Role | null,
): AuctionDto {
  const showReserve =
    viewerRole === SharedRole.ADMIN ||
    (viewerRole === SharedRole.SELLER);
  return {
    id: auction.id,
    sellerId: auction.sellerId,
    title: auction.title,
    description: auction.description,
    status: auction.status,
    startingPrice: auction.startingPrice,
    reservePrice: showReserve ? auction.reservePrice : null,
    reserveMet:
      auction.reservePrice === null
        ? null
        : showReserve || auction.status === SharedAuctionStatus.SETTLED || auction.status === SharedAuctionStatus.ENDED
          ? auction.currentBid >= auction.reservePrice
          : null,
    buyNowPrice: auction.buyNowPrice,
    minIncrement: auction.minIncrement,
    currentBid: auction.currentBid,
    currentWinnerId: auction.currentWinnerId,
    startsAt: auction.startsAt.toISOString(),
    endsAt: auction.endsAt.toISOString(),
    images: (auction.images ?? []).map((img) => ({
      id: img.id,
      url: img.url,
      sortOrder: img.sortOrder,
    })),
    createdAt: auction.createdAt.toISOString(),
    updatedAt: auction.updatedAt.toISOString(),
  };
}

export async function createAuction(sellerId: string, input: CreateAuctionInput): Promise<AuctionDto> {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!(endsAt > startsAt)) {
    throw new AppError(400, "INVALID_DATES", "endsAt must be after startsAt");
  }
  if (input.reservePrice !== undefined && input.reservePrice < input.startingPrice) {
    throw new AppError(400, "INVALID_RESERVE", "Reserve must be >= starting price");
  }
  if (input.buyNowPrice !== undefined && input.buyNowPrice <= input.startingPrice) {
    throw new AppError(400, "INVALID_BUY_NOW", "Buy-now must be greater than starting price");
  }

  const auction = await prisma.auction.create({
    data: {
      sellerId,
      title: input.title,
      description: input.description,
      startingPrice: input.startingPrice,
      reservePrice: input.reservePrice ?? null,
      buyNowPrice: input.buyNowPrice ?? null,
      minIncrement: input.minIncrement,
      startsAt,
      endsAt,
      status: AuctionStatus.DRAFT,
      images: { create: [] },
    },
    include: { images: true },
  });
  return toDto(auction, SharedRole.SELLER);
}

export async function updateAuction(
  auctionId: string,
  actorId: string,
  actorRole: Role,
  input: UpdateAuctionInput,
): Promise<AuctionDto> {
  const existing = await prisma.auction.findUnique({ where: { id: auctionId }, include: { images: true } });
  if (!existing) {
    throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
  }
  if (existing.sellerId !== actorId && actorRole !== SharedRole.ADMIN) {
    throw new AppError(403, "FORBIDDEN", "Not auction owner");
  }
  if (existing.status !== AuctionStatus.DRAFT && existing.status !== AuctionStatus.SCHEDULED) {
    throw new AppError(400, "NOT_EDITABLE", "Only draft/scheduled auctions can be edited");
  }

  const auction = await prisma.auction.update({
    where: { id: auctionId },
    data: {
      title: input.title,
      description: input.description,
      startingPrice: input.startingPrice,
      reservePrice: input.reservePrice,
      buyNowPrice: input.buyNowPrice,
      minIncrement: input.minIncrement,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
    },
    include: { images: true },
  });
  return toDto(auction, actorRole);
}

export async function publishAuction(
  auctionId: string,
  actorId: string,
  actorRole: Role,
  emailQueue: EmailQueue,
): Promise<AuctionDto> {
  const existing = await prisma.auction.findUnique({ where: { id: auctionId }, include: { images: true } });
  if (!existing) {
    throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
  }
  if (existing.sellerId !== actorId && actorRole !== SharedRole.ADMIN) {
    throw new AppError(403, "FORBIDDEN", "Not auction owner");
  }
  if (existing.status !== AuctionStatus.DRAFT && existing.status !== AuctionStatus.SCHEDULED) {
    throw new AppError(400, "INVALID_STATUS", "Cannot publish from current status");
  }

  const now = Date.now();
  const status =
    existing.startsAt.getTime() <= now ? AuctionStatus.LIVE : AuctionStatus.SCHEDULED;

  const auction = await prisma.auction.update({
    where: { id: auctionId },
    data: { status },
    include: { images: true },
  });

  if (status === AuctionStatus.LIVE) {
    await emailQueue.addAuctionLive({
      auctionId: auction.id,
      auctionTitle: auction.title,
    });
  }

  return toDto(auction, actorRole);
}

export async function cancelAuction(auctionId: string, actorId: string, actorRole: Role): Promise<AuctionDto> {
  const result = await prisma.$transaction(async (tx) => {
    const auction = await lockAuctionById(tx, auctionId);
    if (!auction) {
      throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
    }
    if (auction.sellerId !== actorId && actorRole !== SharedRole.ADMIN) {
      throw new AppError(403, "FORBIDDEN", "Not auction owner");
    }
    const cancellable =
      auction.status === AuctionStatus.DRAFT ||
      auction.status === AuctionStatus.SCHEDULED ||
      (actorRole === SharedRole.ADMIN && auction.status === AuctionStatus.LIVE);
    if (!cancellable) {
      throw new AppError(400, "NOT_CANCELLABLE", "Auction cannot be cancelled");
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
      where: { id: auctionId },
      data: {
        status: AuctionStatus.CANCELLED,
        currentWinnerId: null,
        currentBid: 0,
        version: { increment: 1 },
      },
      include: { images: true },
    });
  });
  return toDto(result, actorRole);
}

export async function getAuction(auctionId: string, viewerRole: Role | null): Promise<AuctionDto> {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  if (!auction) {
    throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
  }
  return toDto(auction, viewerRole);
}

export async function listAuctions(input: {
  status?: string;
  page: number;
  pageSize: number;
  viewerRole: Role | null;
  sellerId?: string;
}): Promise<{ items: AuctionDto[]; total: number }> {
  const where = {
    ...(input.status ? { status: input.status as AuctionStatus } : { status: { in: [AuctionStatus.LIVE, AuctionStatus.SCHEDULED, AuctionStatus.ENDED, AuctionStatus.SETTLED] } }),
    ...(input.sellerId ? { sellerId: input.sellerId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auction.count({ where }),
    prisma.auction.findMany({
      where,
      include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } },
      orderBy: { endsAt: "asc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  return {
    total,
    items: rows.map((r) => toDto(r, input.viewerRole)),
  };
}

export async function endAndSettleAuction(
  auctionId: string,
  eventBus: EventBus,
  emailQueue: EmailQueue,
): Promise<void> {
  const settled = await prisma.$transaction(async (tx) => {
    const auction = await lockAuctionById(tx, auctionId);
    if (!auction) {
      return null;
    }
    if (auction.status !== AuctionStatus.LIVE) {
      return null;
    }
    if (auction.endsAt.getTime() > Date.now()) {
      return null;
    }

    const reserveMet =
      auction.reservePrice === null || auction.currentBid >= auction.reservePrice;

    if (!auction.currentWinnerId || auction.currentBid <= 0 || !reserveMet) {
      if (auction.currentWinnerId && auction.currentBid > 0) {
        await lockWalletsByUserIds(tx, [auction.currentWinnerId]);
        await walletService.releaseHoldInTx(
          tx,
          auction.currentWinnerId,
          auction.id,
          auction.currentBid,
        );
      }
      const ended = await tx.auction.update({
        where: { id: auction.id },
        data: {
          status: AuctionStatus.ENDED,
          currentWinnerId: null,
          version: { increment: 1 },
        },
      });
      return { ended, settled: false as const, winnerId: null as string | null, amount: 0 };
    }

    await tx.auction.update({
      where: { id: auction.id },
      data: {
        status: AuctionStatus.ENDED,
        version: { increment: 1 },
      },
    });

    await walletService.captureHoldInTx(
      tx,
      auction.currentWinnerId,
      auction.sellerId,
      auction.id,
      auction.currentBid,
    );

    const ended = await tx.auction.update({
      where: { id: auction.id },
      data: {
        status: AuctionStatus.SETTLED,
        version: { increment: 1 },
      },
    });
    return {
      ended,
      settled: true as const,
      winnerId: auction.currentWinnerId,
      amount: auction.currentBid,
    };
  });

  if (!settled) {
    return;
  }

  await eventBus.publish(RealtimeEvent.AUCTION_ENDED, {
    auctionId: settled.ended.id,
    winnerId: settled.winnerId,
    finalBidCents: settled.ended.currentBid,
  });

  if (settled.settled) {
    await eventBus.publish(RealtimeEvent.AUCTION_SETTLED, {
      auctionId: settled.ended.id,
      winnerId: settled.winnerId,
      amountCents: settled.amount,
    });
    if (settled.winnerId) {
      await emailQueue.addWon({
        userId: settled.winnerId,
        auctionId: settled.ended.id,
        auctionTitle: settled.ended.title,
        amountCents: settled.amount,
      });
    }
  }
}

export { toDto };

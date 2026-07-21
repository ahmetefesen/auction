import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@auction/db";
import {
  auctionListQuerySchema,
  createAuctionSchema,
  updateAuctionSchema,
  createPlaceBidSchema,
  createSetProxyBidSchema,
  PlaceBidSchema,
  CounterOfferSchema,
} from "@auction/shared";
import { AppError } from "../lib/errors.js";
import { requireBuyer, requireSeller, optionalAuth, requireAuth } from "../plugins/auth.js";
import { requireUuidParam } from "../plugins/validate-params.js";
import {
  cancelAuction,
  createAuction,
  getAuction,
  getAuctionSnapshot,
  listAuctions,
  publishAuction,
  updateAuction,
  endAndSettleAuction,
} from "../services/auction.js";
import { placeBid, setProxyBid, biddingService } from "../services/bidding.js";
import {
  acceptCounterOffer,
  acceptHighBid,
  declineNegotiation,
  proposeCounterOffer,
} from "../services/negotiation.js";
import { writeAuditLog, requestMeta } from "../services/audit.js";
import { consumeBidToken } from "../lib/bid-rate-limit.js";

async function assertBidRateLimit(
  redis: Parameters<typeof consumeBidToken>[0],
  userId: string,
  auctionId: string,
): Promise<void> {
  const limit = await consumeBidToken(redis, userId, auctionId);
  if (!limit.allowed) {
    throw new AppError(429, "BID_RATE_LIMITED", "Too many bids on this auction. Retry shortly.", {
      retryAfterSec: limit.retryAfterSec,
    });
  }
}

export async function auctionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auctions", { preHandler: optionalAuth }, async (request) => {
    const query = auctionListQuerySchema.parse(request.query);
    const viewerRole = request.user?.role ?? null;
    return listAuctions({
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
      viewerRole,
    });
  });

  app.get<{ Params: { id: string } }>(
    "/auctions/:id",
    { preHandler: [requireUuidParam(), optionalAuth] },
    async (request) => {
    const viewerRole = request.user?.role ?? null;
    return getAuction(request.params.id, viewerRole);
  });

  app.post("/auctions", { preHandler: requireSeller }, async (request) => {
    const user = request.user;
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const body = createAuctionSchema.parse(request.body);
    const auction = await createAuction(user.id, body);
    const meta = requestMeta(request);
    await writeAuditLog({
      actorId: user.id,
      action: "auction.create",
      entityType: "Auction",
      entityId: auction.id,
      after: auction,
      ...meta,
    });
    return { auction };
  });

  app.patch<{ Params: { id: string } }>(
    "/auctions/:id",
    { preHandler: [requireUuidParam(), requireSeller] },
    async (request) => {
    const user = request.user;
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const body = updateAuctionSchema.parse(request.body);
    const before = await getAuction(request.params.id, user.role);
    const auction = await updateAuction(request.params.id, user.id, user.role, body);
    await writeAuditLog({
      actorId: user.id,
      action: "auction.update",
      entityType: "Auction",
      entityId: auction.id,
      before,
      after: auction,
      ...requestMeta(request),
    });
    return { auction };
  });

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/publish",
    { preHandler: [requireUuidParam(), requireSeller] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const auction = await publishAuction(request.params.id, user.id, user.role, app.emailQueue);
      await writeAuditLog({
        actorId: user.id,
        action: "auction.publish",
        entityType: "Auction",
        entityId: auction.id,
        after: auction,
        ...requestMeta(request),
      });
      return { auction };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/cancel",
    { preHandler: [requireUuidParam(), requireSeller] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const auction = await cancelAuction(request.params.id, user.id, user.role);
      await writeAuditLog({
        actorId: user.id,
        action: "auction.cancel",
        entityType: "Auction",
        entityId: auction.id,
        after: auction,
        ...requestMeta(request),
      });
      return { auction };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/images",
    { preHandler: [requireUuidParam(), requireSeller] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const auction = await prisma.auction.findUnique({ where: { id: request.params.id } });
      if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
      if (auction.sellerId !== user.id && user.role !== "ADMIN") {
        throw new AppError(403, "FORBIDDEN", "Not auction owner");
      }

      const file = await request.file();
      if (!file) throw new AppError(400, "NO_FILE", "Image file required");

      const uploadDir = path.resolve(app.env.UPLOAD_DIR);
      await mkdir(uploadDir, { recursive: true });
      const ext = path.extname(file.filename) || ".jpg";
      const storageKey = `${randomUUID()}${ext}`;
      const dest = path.join(uploadDir, storageKey);
      await pipeline(file.file, createWriteStream(dest));

      const url = `/uploads/${storageKey}`;
      const image = await prisma.auctionImage.create({
        data: {
          auctionId: auction.id,
          url,
          storageKey,
          sortOrder: 0,
        },
      });
      return { image };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/bid-preview",
    { preHandler: [requireUuidParam(), requireBuyer] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const body = PlaceBidSchema.parse(request.body);
      return biddingService.previewBid({
        auctionId: request.params.id,
        bidderId: user.id,
        amountCents: body.amountCents,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/bids",
    { preHandler: [requireUuidParam(), requireBuyer] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

      const idempotencyHeader = request.headers["idempotency-key"];
      const idempotencyKey = typeof idempotencyHeader === "string" ? idempotencyHeader : null;

      if (idempotencyKey) {
        const existing = await prisma.bidIdempotency.findUnique({
          where: { key_userId: { key: idempotencyKey, userId: user.id } },
        });
        if (existing) {
          const auction = await prisma.auction.findUniqueOrThrow({
            where: { id: request.params.id },
          });
          return {
            bidId: existing.bidId,
            auctionId: auction.id,
            currentBid: auction.currentBid,
            currentWinnerId: auction.currentWinnerId,
            endsAt: auction.endsAt.toISOString(),
            extended: false,
          };
        }
      }

      await assertBidRateLimit(app.redis, user.id, request.params.id);

      const auction = await prisma.auction.findUnique({ where: { id: request.params.id } });
      if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");

      const body = createPlaceBidSchema({
        currentBid: auction.currentBid,
        minIncrement: auction.minIncrement,
        startingPrice: auction.startingPrice,
      }).parse(request.body);

      const result = await placeBid({
        auctionId: request.params.id,
        bidderId: user.id,
        amountCents: body.amountCents,
        idempotencyKey,
        eventBus: app.eventBus,
        emailQueue: app.emailQueue,
      });

      return {
        bidId: result.bidId,
        auctionId: result.auction.id,
        currentBid: result.auction.currentBid,
        currentWinnerId: result.auction.currentWinnerId,
        endsAt: result.auction.endsAt.toISOString(),
        extended: result.extended,
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    "/auctions/:id/proxy-bid",
    { preHandler: [requireUuidParam(), requireBuyer] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

      await assertBidRateLimit(app.redis, user.id, request.params.id);

      const auction = await prisma.auction.findUnique({ where: { id: request.params.id } });
      if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");

      const body = createSetProxyBidSchema({
        currentBid: auction.currentBid,
      }).parse(request.body);

      const result = await setProxyBid({
        auctionId: request.params.id,
        bidderId: user.id,
        maxAmountCents: body.maxAmountCents,
        eventBus: app.eventBus,
        emailQueue: app.emailQueue,
      });
      return {
        bidId: result.bidId,
        currentBid: result.auction.currentBid,
        currentWinnerId: result.auction.currentWinnerId,
        endsAt: result.auction.endsAt.toISOString(),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/auctions/:id/proxy-bid",
    { preHandler: [requireUuidParam(), requireBuyer] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const auction = await prisma.auction.findUnique({ where: { id: request.params.id } });
      if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
      const proxy = await prisma.proxyBid.findUnique({
        where: {
          auctionId_bidderId: { auctionId: request.params.id, bidderId: user.id },
        },
      });
      return {
        auctionId: request.params.id,
        maxAmountCents: proxy?.maxAmount ?? null,
        updatedAt: proxy?.updatedAt.toISOString() ?? null,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/auctions/:id/snapshot",
    { preHandler: [requireUuidParam(), optionalAuth] },
    async (request) => {
      const viewerUserId = request.user?.id ?? null;
      return getAuctionSnapshot(request.params.id, viewerUserId);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/auctions/:id/bids",
    { preHandler: requireUuidParam() },
    async (request) => {
    const bids = await prisma.bid.findMany({
      where: { auctionId: request.params.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      bids: bids.map((b) => ({
        id: b.id,
        auctionId: b.auctionId,
        bidderId: b.bidderId,
        amount: b.amount,
        isProxy: b.isProxy,
        createdAt: b.createdAt.toISOString(),
      })),
    };
  });

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/watch",
    { preHandler: [requireUuidParam(), requireBuyer] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      await prisma.watchlist.upsert({
        where: {
          userId_auctionId: { userId: user.id, auctionId: request.params.id },
        },
        create: { userId: user.id, auctionId: request.params.id },
        update: {},
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/auctions/:id/watch",
    { preHandler: [requireUuidParam(), requireBuyer] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      await prisma.watchlist.deleteMany({
        where: { userId: user.id, auctionId: request.params.id },
      });
      return { ok: true };
    },
  );

  app.get("/me/watchlist", { preHandler: requireBuyer }, async (request) => {
    const user = request.user;
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const rows = await prisma.watchlist.findMany({
      where: { userId: user.id },
      include: { auction: { include: { images: { take: 1 } } } },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: rows.map((r) => ({
        auctionId: r.auctionId,
        title: r.auction.title,
        status: r.auction.status,
        currentBid: r.auction.currentBid,
        endsAt: r.auction.endsAt.toISOString(),
        imageUrl: r.auction.images[0]?.url ?? null,
      })),
    };
  });

  app.get("/me/auctions", { preHandler: requireSeller }, async (request) => {
    const user = request.user;
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    return listAuctions({
      page: 1,
      pageSize: 50,
      viewerRole: user.role,
      sellerId: user.role === "ADMIN" ? undefined : user.id,
    });
  });

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/negotiation/accept",
    { preHandler: [requireUuidParam(), requireSeller] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const auction = await acceptHighBid({
        auctionId: request.params.id,
        actorId: user.id,
        actorRole: user.role,
        eventBus: app.eventBus,
        emailQueue: app.emailQueue,
      });
      return { auction };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/negotiation/counter",
    { preHandler: [requireUuidParam(), requireSeller] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const body = CounterOfferSchema.parse(request.body);
      const auction = await proposeCounterOffer({
        auctionId: request.params.id,
        actorId: user.id,
        actorRole: user.role,
        amountCents: body.amountCents,
        eventBus: app.eventBus,
      });
      return { auction };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/negotiation/accept-counter",
    { preHandler: [requireUuidParam(), requireBuyer] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const auction = await acceptCounterOffer({
        auctionId: request.params.id,
        actorId: user.id,
        actorRole: user.role,
        eventBus: app.eventBus,
        emailQueue: app.emailQueue,
      });
      return { auction };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/auctions/:id/negotiation/decline",
    { preHandler: [requireUuidParam(), requireAuth] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const auction = await declineNegotiation({
        auctionId: request.params.id,
        actorId: user.id,
        actorRole: user.role,
        eventBus: app.eventBus,
      });
      return { auction };
    },
  );

  // Internal helper for admin force-end re-export
  void endAndSettleAuction;
}

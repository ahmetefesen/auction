import type { FastifyInstance } from "fastify";
import { prisma, AuctionStatus } from "@auction/db";
import { forceEndAuctionSchema, updateUserStatusSchema, auditLogListQuerySchema } from "@auction/shared";
import { AppError } from "../lib/errors.js";
import { requireAdmin, requireSeller } from "../plugins/auth.js";
import { requireUuidParam } from "../plugins/validate-params.js";
import { endAndSettleAuction, cancelAuction } from "../services/auction.js";
import { writeAuditLogTx, requestMeta } from "../services/audit.js";
import { collectAdminMetrics } from "../services/metrics.js";

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return "***@***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0] ?? "*"}***@${domain}`;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/metrics", { preHandler: requireAdmin }, async () => {
    return collectAdminMetrics({
      redis: app.redis,
      redisUrl: app.env.REDIS_URL,
      io: app.io,
    });
  });

  app.get("/admin/auctions/live", { preHandler: requireAdmin }, async () => {
    const items = await prisma.auction.findMany({
      where: { status: AuctionStatus.LIVE },
      orderBy: { endsAt: "asc" },
      take: 100,
      include: { images: { take: 1 } },
    });
    return {
      items: items.map((a) => ({
        id: a.id,
        title: a.title,
        currentBid: a.currentBid,
        currentWinnerId: a.currentWinnerId,
        endsAt: a.endsAt.toISOString(),
        sellerId: a.sellerId,
      })),
    };
  });

  app.get("/admin/audit-logs", { preHandler: requireAdmin }, async (request) => {
    const q = auditLogListQuerySchema.parse(request.query);
    const where = {
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
    };
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: logs.map((l) => ({
        id: l.id,
        actorId: l.actorId,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        before: l.before,
        after: l.after,
        ip: l.ip,
        userAgent: l.userAgent,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });

  app.get("/admin/users", { preHandler: requireAdmin }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    return {
      users: users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/users/:id/status",
    { preHandler: [requireUuidParam(), requireAdmin] },
    async (request) => {
      const admin = request.user;
      if (!admin) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const body = updateUserStatusSchema.parse(request.body);
      const meta = requestMeta(request);

      const after = await prisma.$transaction(async (tx) => {
        const before = await tx.user.findUnique({ where: { id: request.params.id } });
        if (!before) throw new AppError(404, "USER_NOT_FOUND", "User not found");

        const updated = await tx.user.update({
          where: { id: request.params.id },
          data: { status: body.status },
        });

        await writeAuditLogTx(tx, {
          actorId: admin.id,
          action: "user.status_update",
          entityType: "User",
          entityId: updated.id,
          before: { status: before.status },
          after: { status: updated.status },
          ...meta,
        });

        return updated;
      });

      return {
        user: {
          id: after.id,
          email: after.email,
          displayName: after.displayName,
          role: after.role,
          status: after.status,
          createdAt: after.createdAt.toISOString(),
        },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/auctions/:id/force-end",
    { preHandler: [requireUuidParam(), requireAdmin] },
    async (request) => {
      const admin = request.user;
      if (!admin) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const body = forceEndAuctionSchema.parse(request.body);
      const meta = requestMeta(request);

      await prisma.$transaction(async (tx) => {
        const auction = await tx.auction.findUnique({ where: { id: request.params.id } });
        if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");

        await tx.auction.update({
          where: { id: request.params.id },
          data: { endsAt: new Date() },
        });

        await writeAuditLogTx(tx, {
          actorId: admin.id,
          action: "auction.force_end",
          entityType: "Auction",
          entityId: request.params.id,
          before: { endsAt: auction.endsAt.toISOString(), status: auction.status },
          after: { endsAt: new Date().toISOString(), reason: body.reason },
          ...meta,
        });
      });

      await endAndSettleAuction(request.params.id, app.eventBus, app.emailQueue);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/auctions/:id/force-cancel",
    { preHandler: [requireUuidParam(), requireAdmin] },
    async (request) => {
      const admin = request.user;
      if (!admin) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      const body = forceEndAuctionSchema.parse(request.body);
      const meta = requestMeta(request);

      const auction = await cancelAuction(request.params.id, admin.id, admin.role);

      await prisma.$transaction(async (tx) => {
        await writeAuditLogTx(tx, {
          actorId: admin.id,
          action: "auction.force_cancel",
          entityType: "Auction",
          entityId: request.params.id,
          after: { status: auction.status, reason: body.reason },
          ...meta,
        });
      });

      return { auction };
    },
  );
}

/** Seller-only winner insights with privacy masking */
export async function sellerInsightRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/auctions/:id/winner-insights",
    { preHandler: [requireUuidParam(), requireSeller] },
    async (request) => {
      const user = request.user;
      if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

      const auction = await prisma.auction.findUnique({ where: { id: request.params.id } });
      if (!auction) throw new AppError(404, "AUCTION_NOT_FOUND", "Auction not found");
      if (auction.sellerId !== user.id && user.role !== "ADMIN") {
        throw new AppError(403, "FORBIDDEN", "Not auction owner");
      }
      if (auction.status !== AuctionStatus.SETTLED || !auction.currentWinnerId) {
        throw new AppError(400, "NO_WINNER", "Auction has no settled winner");
      }

      const winner = await prisma.user.findUniqueOrThrow({
        where: { id: auction.currentWinnerId },
        select: { id: true, displayName: true, email: true },
      });

      const settledWins = await prisma.auction.count({
        where: { currentWinnerId: winner.id, status: AuctionStatus.SETTLED },
      });
      const totalBids = await prisma.bid.count({ where: { bidderId: winner.id } });
      const trustScore = Math.min(
        100,
        Math.round(40 + settledWins * 8 + Math.min(totalBids, 50) * 0.5),
      );

      const purchases = await prisma.auction.findMany({
        where: {
          currentWinnerId: winner.id,
          status: AuctionStatus.SETTLED,
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          currentBid: true,
          updatedAt: true,
        },
      });

      return {
        winner: {
          id: winner.id,
          displayName: winner.displayName,
          emailMasked: maskEmail(winner.email),
        },
        trustScore,
        purchases: purchases.map((p) => ({
          auctionId: p.id,
          title: p.title,
          amountCents: p.currentBid,
          settledAt: p.updatedAt.toISOString(),
        })),
      };
    },
  );
}

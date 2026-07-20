import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@auction/db";
import { AuctionStatus } from "@auction/shared";
import { biddingService } from "../services/bidding.js";
import { endAndSettleAuction } from "../services/auction.js";
import {
  buyerAuthCookies,
  closeTestApp,
  createLiveAuction,
  createMockEmailQueue,
  createMockEventBus,
  createTestApp,
  idempotencyKey,
  resetDatabase,
  seedTestUsers,
  type TestContext,
  type TestUsers,
} from "../test/helpers.js";

describe("bidding integration", () => {
  let ctx: TestContext;
  let users: TestUsers;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    if (ctx) {
      await closeTestApp(ctx);
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
  });

  it("resolves concurrent opening bids with a single winner and correct escrow holds", async () => {
    const auction = await createLiveAuction(users.seller.id);
    const eventBus = createMockEventBus();
    const emailQueue = createMockEmailQueue();

    const [first, second] = await Promise.allSettled([
      biddingService.placeBid({
        auctionId: auction.id,
        bidderId: users.buyer1.id,
        amountCents: 10_000,
        idempotencyKey: idempotencyKey(),
        eventBus,
        emailQueue,
      }),
      biddingService.placeBid({
        auctionId: auction.id,
        bidderId: users.buyer2.id,
        amountCents: 10_000,
        idempotencyKey: idempotencyKey(),
        eventBus,
        emailQueue,
      }),
    ]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const updated = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(updated.currentBid).toBe(10_000);
    expect(updated.currentWinnerId).not.toBeNull();

    const bidCount = await prisma.bid.count({ where: { auctionId: auction.id } });
    expect(bidCount).toBeGreaterThanOrEqual(1);
    expect(bidCount).toBeLessThanOrEqual(2);

    const wallets = await prisma.wallet.findMany({
      where: { userId: { in: [users.buyer1.id, users.buyer2.id] } },
    });
    const totalHeld = wallets.reduce((sum, w) => sum + w.heldBalance, 0);
    expect(totalHeld).toBe(10_000);

    const winnerWallet = wallets.find((w) => w.userId === updated.currentWinnerId);
    expect(winnerWallet?.heldBalance).toBe(10_000);
  });

  it("extends endsAt inside anti-snipe window and prevents early settlement", async () => {
    const originalEndsAt = new Date(Date.now() + 20_000);
    const auction = await createLiveAuction(users.seller.id, {
      endsAt: originalEndsAt,
      antiSnipeWindowSec: 30,
      antiSnipeExtendSec: 60,
    });

    const eventBus = createMockEventBus();
    const emailQueue = createMockEmailQueue();

    const result = await biddingService.placeBid({
      auctionId: auction.id,
      bidderId: users.buyer1.id,
      amountCents: 10_000,
      idempotencyKey: idempotencyKey(),
      eventBus,
      emailQueue,
    });

    expect(result.extended).toBe(true);
    expect(result.auction.endsAt.getTime()).toBe(originalEndsAt.getTime() + 60_000);

    await endAndSettleAuction(auction.id, eventBus, emailQueue);

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(after.status).toBe(AuctionStatus.LIVE);
    expect(after.endsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("deduplicates repeated bids with the same Idempotency-Key", async () => {
    const auction = await createLiveAuction(users.seller.id);
    const cookies = await buyerAuthCookies(ctx.env, users.buyer1.id);
    const key = randomUUID();

    const first = await ctx.app.inject({
      method: "POST",
      url: `/auctions/${auction.id}/bids`,
      cookies,
      headers: {
        "idempotency-key": key,
      },
      payload: { amountCents: 10_000 },
    });

    const second = await ctx.app.inject({
      method: "POST",
      url: `/auctions/${auction.id}/bids`,
      cookies,
      headers: {
        "idempotency-key": key,
      },
      payload: { amountCents: 10_000 },
    });

    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);

    const firstBody = first.json() as { bidId: string };
    const secondBody = second.json() as { bidId: string };
    expect(secondBody.bidId).toBe(firstBody.bidId);

    const bidCount = await prisma.bid.count({ where: { auctionId: auction.id } });
    expect(bidCount).toBe(1);

    const idempotencyCount = await prisma.bidIdempotency.count({
      where: { key, userId: users.buyer1.id },
    });
    expect(idempotencyCount).toBe(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: users.buyer1.id } });
    expect(wallet.heldBalance).toBe(10_000);
  });

  it("returns authoritative snapshot for reconnect catch-up", async () => {
    const auction = await createLiveAuction(users.seller.id);
    const eventBus = createMockEventBus();
    const emailQueue = createMockEmailQueue();

    await biddingService.placeBid({
      auctionId: auction.id,
      bidderId: users.buyer1.id,
      amountCents: 10_000,
      idempotencyKey: idempotencyKey(),
      eventBus,
      emailQueue,
    });

    const cookies = await buyerAuthCookies(ctx.env, users.buyer1.id);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/auctions/${auction.id}/snapshot`,
      cookies,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      serverTime: string;
      auction: { currentBid: number; currentWinnerId: string; version: number };
      bids: Array<{ amount: number }>;
      wallet: { heldBalance: number; availableBalance: number } | null;
    };

    expect(body.auction.currentBid).toBe(10_000);
    expect(body.auction.currentWinnerId).toBe(users.buyer1.id);
    expect(body.auction.version).toBeGreaterThan(0);
    expect(body.bids.length).toBeGreaterThanOrEqual(1);
    expect(body.bids[0]?.amount).toBe(10_000);
    expect(body.wallet?.heldBalance).toBe(10_000);
    expect(body.wallet?.availableBalance).toBe(490_000);
    expect(new Date(body.serverTime).getTime()).not.toBeNaN();
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@auction/db";
import { AuctionStatus } from "@auction/shared";
import { biddingService } from "../services/bidding.js";
import { endAndSettleAuction } from "../services/auction.js";
import { expireNegotiationIfDue } from "../services/negotiation.js";
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
  sellerAuthCookies,
  type TestContext,
  type TestUsers,
} from "../test/helpers.js";

describe("reserve negotiation", () => {
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

  async function openNegotiation() {
    const auction = await createLiveAuction(users.seller.id, {
      startingPrice: 10_000,
      reservePrice: 50_000,
      endsAt: new Date(Date.now() - 1_000),
    });
    // Make LIVE with past endsAt but place bid while temporarily LIVE with future end
    await prisma.auction.update({
      where: { id: auction.id },
      data: { endsAt: new Date(Date.now() + 60_000) },
    });
    await biddingService.placeBid({
      auctionId: auction.id,
      bidderId: users.buyer1.id,
      amountCents: 10_000,
      idempotencyKey: idempotencyKey(),
      eventBus: createMockEventBus(),
      emailQueue: createMockEmailQueue(),
    });
    await prisma.auction.update({
      where: { id: auction.id },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });
    await endAndSettleAuction(auction.id, createMockEventBus(), createMockEmailQueue());
    return prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
  }

  it("moves below-reserve lots to NEGOTIATING and keeps the hold", async () => {
    const auction = await openNegotiation();
    expect(auction.status).toBe(AuctionStatus.NEGOTIATING);
    expect(auction.negotiationExpiresAt).not.toBeNull();
    expect(auction.currentWinnerId).toBe(users.buyer1.id);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: users.buyer1.id },
    });
    expect(wallet.heldBalance).toBe(10_000);
  });

  it("settles when seller accepts the high bid", async () => {
    const auction = await openNegotiation();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/auctions/${auction.id}/negotiation/accept`,
      cookies: await sellerAuthCookies(ctx.env, users.seller.id),
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(after.status).toBe(AuctionStatus.SETTLED);

    const buyerWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: users.buyer1.id },
    });
    expect(buyerWallet.heldBalance).toBe(0);

    const sellerWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: users.seller.id },
    });
    expect(sellerWallet.availableBalance).toBe(10_000);
  });

  it("releases hold when negotiation expires", async () => {
    const auction = await openNegotiation();
    await prisma.auction.update({
      where: { id: auction.id },
      data: { negotiationExpiresAt: new Date(Date.now() - 1_000) },
    });
    await expireNegotiationIfDue(auction.id, createMockEventBus());
    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(after.status).toBe(AuctionStatus.ENDED);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: users.buyer1.id },
    });
    expect(wallet.heldBalance).toBe(0);
  });
});

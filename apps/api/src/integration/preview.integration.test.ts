import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@auction/db";
import { maskBidderId, type BidPreviewDto } from "@auction/shared";
import { biddingService } from "../services/bidding.js";
import {
  buyerAuthCookies,
  closeTestApp,
  createLiveAuction,
  createTestApp,
  resetDatabase,
  seedTestUsers,
  type TestContext,
  type TestUsers,
} from "../test/helpers.js";

describe("bid preview", () => {
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

  it("maskBidderId hides the full id with a stable tail", () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(maskBidderId(id)).toBe("User***90");
    expect(maskBidderId(id)).toBe(maskBidderId(id));
  });

  it("previews hold delta, minimum, and anti-snipe extension", async () => {
    const endsAt = new Date(Date.now() + 20_000);
    const auction = await createLiveAuction(users.seller.id, {
      endsAt,
      antiSnipeWindowSec: 30,
      antiSnipeExtendSec: 60,
      startingPrice: 10_000,
      minIncrement: 500,
    });

    const preview = await biddingService.previewBid({
      auctionId: auction.id,
      bidderId: users.buyer1.id,
      amountCents: 10_000,
    });

    expect(preview.minRequiredCents).toBe(10_000);
    expect(preview.meetsMinimum).toBe(true);
    expect(preview.becomesLeader).toBe(true);
    expect(preview.holdDeltaCents).toBe(10_000);
    expect(preview.insufficientFunds).toBe(false);
    expect(preview.wouldExtend).toBe(true);
    expect(preview.extendedEndsAt).not.toBeNull();
    expect(new Date(preview.extendedEndsAt!).getTime()).toBe(endsAt.getTime() + 60_000);
  });

  it("flags insufficient funds and below-minimum amounts via HTTP", async () => {
    const auction = await createLiveAuction(users.seller.id, {
      startingPrice: 10_000,
    });

    const low = await ctx.app.inject({
      method: "POST",
      url: `/auctions/${auction.id}/bid-preview`,
      cookies: await buyerAuthCookies(ctx.env, users.buyer1.id),
      payload: { amountCents: 100 },
    });
    expect(low.statusCode).toBe(200);
    const lowBody = low.json() as BidPreviewDto;
    expect(lowBody.meetsMinimum).toBe(false);
    expect(lowBody.becomesLeader).toBe(false);
    expect(lowBody.wouldExtend).toBe(false);

    await prisma.wallet.update({
      where: { userId: users.buyer1.id },
      data: { availableBalance: 500 },
    });

    const broke = await ctx.app.inject({
      method: "POST",
      url: `/auctions/${auction.id}/bid-preview`,
      cookies: await buyerAuthCookies(ctx.env, users.buyer1.id),
      payload: { amountCents: 10_000 },
    });
    expect(broke.statusCode).toBe(200);
    const brokeBody = broke.json() as BidPreviewDto;
    expect(brokeBody.insufficientFunds).toBe(true);
    expect(brokeBody.holdDeltaCents).toBe(10_000);
  });
});

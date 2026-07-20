import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@auction/db";
import {
  BID_BUCKET_CAPACITY,
  consumeBidToken,
  resetBidRateLimit,
} from "../lib/bid-rate-limit.js";
import {
  buyerAuthCookies,
  closeTestApp,
  createLiveAuction,
  createTestApp,
  idempotencyKey,
  resetDatabase,
  seedTestUsers,
  type TestContext,
  type TestUsers,
} from "../test/helpers.js";

describe("lot bid rate limit", () => {
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

  it("allows a burst of capacity then returns 429 with Retry-After", async () => {
    const auction = await createLiveAuction(users.seller.id, {
      startingPrice: 10_000,
      minIncrement: 500,
    });
    await resetBidRateLimit(ctx.redis, users.buyer1.id, auction.id);

    const cookies = await buyerAuthCookies(ctx.env, users.buyer1.id);
    const amounts = [10_000, 10_500, 11_000, 11_500];

    for (let i = 0; i < BID_BUCKET_CAPACITY; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/auctions/${auction.id}/bids`,
        cookies,
        headers: { "idempotency-key": idempotencyKey() },
        payload: { amountCents: amounts[i] },
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    const blocked = await ctx.app.inject({
      method: "POST",
      url: `/auctions/${auction.id}/bids`,
      cookies,
      headers: { "idempotency-key": idempotencyKey() },
      payload: { amountCents: amounts[3] },
    });

    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { error: { code: string } };
    expect(body.error.code).toBe("BID_RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeTruthy();
  });

  it("scopes the bucket per auction", async () => {
    const a1 = await createLiveAuction(users.seller.id);
    const a2 = await createLiveAuction(users.seller.id);
    await resetBidRateLimit(ctx.redis, users.buyer1.id, a1.id);
    await resetBidRateLimit(ctx.redis, users.buyer1.id, a2.id);

    for (let i = 0; i < BID_BUCKET_CAPACITY; i++) {
      const r = await consumeBidToken(ctx.redis, users.buyer1.id, a1.id);
      expect(r.allowed).toBe(true);
    }
    const denied = await consumeBidToken(ctx.redis, users.buyer1.id, a1.id);
    expect(denied.allowed).toBe(false);

    const otherLot = await consumeBidToken(ctx.redis, users.buyer1.id, a2.id);
    expect(otherLot.allowed).toBe(true);
  });

  it("applies the same guard to proxy-bid", async () => {
    const auction = await createLiveAuction(users.seller.id, { startingPrice: 10_000 });
    await resetBidRateLimit(ctx.redis, users.buyer1.id, auction.id);
    const cookies = await buyerAuthCookies(ctx.env, users.buyer1.id);

    for (let i = 0; i < BID_BUCKET_CAPACITY; i++) {
      await consumeBidToken(ctx.redis, users.buyer1.id, auction.id);
    }

    const res = await ctx.app.inject({
      method: "PUT",
      url: `/auctions/${auction.id}/proxy-bid`,
      cookies,
      payload: { maxAmountCents: 50_000 },
    });
    expect(res.statusCode).toBe(429);
  });
});

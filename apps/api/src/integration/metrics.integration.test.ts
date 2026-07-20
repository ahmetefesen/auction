import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@auction/db";
import type { AdminMetricsDto } from "@auction/shared";
import {
  adminAuthCookies,
  buyerAuthCookies,
  closeTestApp,
  createTestApp,
  resetDatabase,
  seedAdminUser,
  seedTestUsers,
  type TestContext,
} from "../test/helpers.js";

describe("admin metrics", () => {
  let ctx: TestContext;

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
  });

  it("returns metrics for admin and rejects buyer", async () => {
    const admin = await seedAdminUser();
    const users = await seedTestUsers();

    const adminRes = await ctx.app.inject({
      method: "GET",
      url: "/admin/metrics",
      cookies: await adminAuthCookies(ctx.env, admin.id),
    });

    expect(adminRes.statusCode).toBe(200);
    const body = adminRes.json() as AdminMetricsDto;
    expect(body.serverTime).toBeTruthy();
    expect(body.redis.ok).toBe(true);
    expect(body.postgres.ok).toBe(true);
    expect(typeof body.wallet.totalHeldBalance).toBe("number");
    expect(typeof body.auctions.liveCount).toBe("number");
    expect(body.sockets.active).toBeNull();
    expect(body.queues).toHaveProperty("email");
    expect(body.queues).toHaveProperty("auctionCloser");

    const buyerRes = await ctx.app.inject({
      method: "GET",
      url: "/admin/metrics",
      cookies: await buyerAuthCookies(ctx.env, users.buyer1.id),
    });
    expect(buyerRes.statusCode).toBe(403);
  });

  it("reports dependency status on public /health", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; postgres: string; redis: string };
    expect(body.ok).toBe(true);
    expect(body.postgres).toBe("ok");
    expect(body.redis).toBe("ok");
  });
});

import { randomUUID } from "node:crypto";
import { prisma, AuctionStatus, Role, type User } from "@auction/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { resetEnvCache, loadEnv, type Env } from "../config/env.js";
import { ACCESS_COOKIE, hashPassword, signAccessToken } from "../lib/auth-tokens.js";
import type { EventBus } from "../realtime/event-bus.js";
import type { EmailQueue } from "../queues/email.js";
import { assertTestInfra, createTestRedis, withTimeout } from "./infra.js";

export type TestContext = {
  app: FastifyInstance;
  env: Env;
  redis: ReturnType<typeof createTestRedis>;
  eventBus: EventBus;
  emailQueue: EmailQueue;
};

export type TestUsers = {
  seller: User;
  buyer1: User;
  buyer2: User;
};

export function createMockEventBus(): EventBus {
  return {
    publish: async () => undefined,
    attachIo: () => undefined,
    startSubscriber: () => undefined,
  } as unknown as EventBus;
}

export function createMockEmailQueue(): EmailQueue {
  return {
    addOutbid: async () => undefined,
    addWon: async () => undefined,
    addEndingSoon: async () => undefined,
    addAuctionLive: async () => undefined,
    close: async () => undefined,
  } as unknown as EmailQueue;
}

export async function createTestApp(): Promise<TestContext> {
  resetEnvCache();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "test",
  });

  await assertTestInfra(env.DATABASE_URL, env.REDIS_URL);

  const redis = createTestRedis(env.REDIS_URL);
  await withTimeout(redis.connect(), 5_000, "Redis connect");
  await withTimeout(redis.ping(), 5_000, "Redis ping");

  const eventBus = createMockEventBus();
  const emailQueue = createMockEmailQueue();
  const app = await withTimeout(
    Promise.resolve(buildApp({ env, eventBus, emailQueue, redis, disableRateLimit: true })),
    15_000,
    "Fastify buildApp",
  );
  await withTimeout(Promise.resolve(app.ready()), 10_000, "Fastify ready");

  return { app, env, redis, eventBus, emailQueue };
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  ctx.redis.disconnect();
}

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "BidIdempotency",
      "Bid",
      "ProxyBid",
      "Watchlist",
      "AuctionImage",
      "Auction",
      "WalletTransaction",
      "Wallet",
      "RefreshToken",
      "AuditLog",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

export async function seedTestUsers(): Promise<TestUsers> {
  const passwordHash = await hashPassword("Password123!");

  const seller = await prisma.user.create({
    data: {
      email: `seller-${randomUUID()}@test.local`,
      passwordHash,
      displayName: "Test Seller",
      role: Role.SELLER,
      wallet: { create: {} },
    },
  });

  const buyer1 = await prisma.user.create({
    data: {
      email: `buyer1-${randomUUID()}@test.local`,
      passwordHash,
      displayName: "Test Buyer 1",
      role: Role.BUYER,
      wallet: {
        create: {
          availableBalance: 500_000,
          heldBalance: 0,
        },
      },
    },
  });

  const buyer2 = await prisma.user.create({
    data: {
      email: `buyer2-${randomUUID()}@test.local`,
      passwordHash,
      displayName: "Test Buyer 2",
      role: Role.BUYER,
      wallet: {
        create: {
          availableBalance: 500_000,
          heldBalance: 0,
        },
      },
    },
  });

  return { seller, buyer1, buyer2 };
}

export async function createLiveAuction(
  sellerId: string,
  options?: {
    endsAt?: Date;
    antiSnipeWindowSec?: number;
    antiSnipeExtendSec?: number;
    startingPrice?: number;
    minIncrement?: number;
    reservePrice?: number | null;
  },
) {
  const now = Date.now();
  return prisma.auction.create({
    data: {
      sellerId,
      title: "Integration Test Auction",
      description: "Test lot",
      status: AuctionStatus.LIVE,
      startingPrice: options?.startingPrice ?? 10_000,
      minIncrement: options?.minIncrement ?? 500,
      reservePrice: options?.reservePrice === undefined ? null : options.reservePrice,
      currentBid: 0,
      startsAt: new Date(now - 60_000),
      endsAt: options?.endsAt ?? new Date(now + 60 * 60_000),
      antiSnipeWindowSec: options?.antiSnipeWindowSec ?? 30,
      antiSnipeExtendSec: options?.antiSnipeExtendSec ?? 60,
    },
  });
}

export async function buyerAuthCookie(env: Env, userId: string): Promise<string> {
  const token = await signAccessToken(env, userId, Role.BUYER);
  return `${ACCESS_COOKIE}=${token}`;
}

export async function buyerAuthCookies(env: Env, userId: string): Promise<Record<string, string>> {
  const token = await signAccessToken(env, userId, Role.BUYER);
  return { [ACCESS_COOKIE]: token };
}

export async function sellerAuthCookies(env: Env, userId: string): Promise<Record<string, string>> {
  const token = await signAccessToken(env, userId, Role.SELLER);
  return { [ACCESS_COOKIE]: token };
}

export async function adminAuthCookies(env: Env, userId: string): Promise<Record<string, string>> {
  const token = await signAccessToken(env, userId, Role.ADMIN);
  return { [ACCESS_COOKIE]: token };
}

export async function seedAdminUser(): Promise<User> {
  const passwordHash = await hashPassword("Password123!");
  return prisma.user.create({
    data: {
      email: `admin-${randomUUID()}@test.local`,
      passwordHash,
      displayName: "Test Admin",
      role: Role.ADMIN,
      wallet: { create: {} },
    },
  });
}

export function idempotencyKey(): string {
  return randomUUID();
}

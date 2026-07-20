import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { formatZodError } from "@auction/shared";
import type { Redis } from "ioredis";
import type { Server as SocketServer } from "socket.io";
import { prisma } from "@auction/db";
import type { Env } from "./config/env.js";
import { isAppError } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { walletRoutes } from "./routes/wallet.js";
import { auctionRoutes } from "./routes/auctions.js";
import { adminRoutes, sellerInsightRoutes } from "./routes/admin.js";
import type { EventBus } from "./realtime/event-bus.js";
import type { EmailQueue } from "./queues/email.js";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
    eventBus: EventBus;
    emailQueue: EmailQueue;
    redis: Redis;
    /** Attached after listen in index.ts; null in tests until set. */
    io: SocketServer | null;
  }
}

export async function buildApp(input: {
  env: Env;
  eventBus: EventBus;
  emailQueue: EmailQueue;
  redis: Redis;
  disableRateLimit?: boolean;
}) {
  const app = Fastify({
    logger: {
      level: input.env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  app.decorate("env", input.env);
  app.decorate("eventBus", input.eventBus);
  app.decorate("emailQueue", input.emailQueue);
  app.decorate("redis", input.redis);
  app.decorate("io", null);

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: input.env.CORS_ORIGIN,
    credentials: true,
  });
  await app.register(cookie);
  if (!input.disableRateLimit) {
    await app.register(rateLimit, {
      max: 200,
      timeWindow: "1 minute",
      redis: input.redis,
    });
  }
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });
  await app.register(fastifyStatic, {
    root: path.resolve(input.env.UPLOAD_DIR),
    prefix: "/uploads/",
    decorateReply: false,
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      if (
        error.statusCode === 429 &&
        error.details &&
        typeof error.details === "object" &&
        error.details !== null &&
        "retryAfterSec" in error.details
      ) {
        const retry = (error.details as { retryAfterSec: unknown }).retryAfterSec;
        if (typeof retry === "number" && Number.isFinite(retry)) {
          void reply.header("Retry-After", String(Math.max(1, Math.ceil(retry))));
        }
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    if (error && typeof error === "object" && "validation" in error) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error,
        },
      });
    }

    // Zod
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: formatZodError(error),
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  });

  app.get("/health", async () => {
    let postgres: "ok" | "error" = "error";
    let redis: "ok" | "error" = "error";

    try {
      await prisma.$queryRaw`SELECT 1`;
      postgres = "ok";
    } catch {
      postgres = "error";
    }

    try {
      const pong = await input.redis.ping();
      redis = pong === "PONG" ? "ok" : "error";
    } catch {
      redis = "error";
    }

    const ok = postgres === "ok" && redis === "ok";
    return { ok, postgres, redis };
  });

  await app.register(authRoutes);
  await app.register(walletRoutes);
  await app.register(auctionRoutes);
  await app.register(adminRoutes);
  await app.register(sellerInsightRoutes);

  // Stricter bid rate limit
  app.addHook("onRoute", (routeOptions) => {
    if (routeOptions.url === "/auctions/:id/bids" && routeOptions.method === "POST") {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      };
    }
  });

  return app;
}

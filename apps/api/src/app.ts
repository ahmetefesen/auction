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
  }
}

export async function buildApp(input: {
  env: Env;
  eventBus: EventBus;
  emailQueue: EmailQueue;
  redis: Redis;
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

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: input.env.CORS_ORIGIN,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    redis: input.redis,
  });
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

  app.get("/health", async () => ({ ok: true }));

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

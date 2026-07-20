import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Server as SocketServer } from "socket.io";
import { prisma, AuctionStatus } from "@auction/db";
import type { AdminMetricsDto, QueueJobCountsDto } from "@auction/shared";

const ENDING_SOON_MS = 15 * 60_000;

async function measureRedisLatency(redis: Redis): Promise<{ latencyMs: number | null; ok: boolean }> {
  const t0 = performance.now();
  try {
    const pong = await redis.ping();
    const latencyMs = Math.round(performance.now() - t0);
    return { latencyMs, ok: pong === "PONG" };
  } catch {
    return { latencyMs: null, ok: false };
  }
}

async function measurePostgresLatency(): Promise<{ latencyMs: number | null; ok: boolean }> {
  const t0 = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { latencyMs: Math.round(performance.now() - t0), ok: true };
  } catch {
    return { latencyMs: null, ok: false };
  }
}

async function getQueueCounts(
  redisUrl: string,
  queueName: string,
): Promise<QueueJobCountsDto | null> {
  const queue = new Queue(queueName, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
  });
  try {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    return {
      waiting: counts["waiting"] ?? 0,
      active: counts["active"] ?? 0,
      completed: counts["completed"] ?? 0,
      failed: counts["failed"] ?? 0,
      delayed: counts["delayed"] ?? 0,
    };
  } catch {
    return null;
  } finally {
    await queue.close();
  }
}

function activeSocketCount(io: SocketServer | null | undefined): number | null {
  if (!io) return null;
  return io.engine.clientsCount;
}

export async function collectAdminMetrics(input: {
  redis: Redis;
  redisUrl: string;
  io: SocketServer | null;
}): Promise<AdminMetricsDto> {
  const now = new Date();
  const endingSoonCutoff = new Date(now.getTime() + ENDING_SOON_MS);

  const [redisHealth, postgresHealth, walletAgg, liveCount, endingSoonCount, emailQueue, closerQueue] =
    await Promise.all([
      measureRedisLatency(input.redis),
      measurePostgresLatency(),
      prisma.wallet.aggregate({
        _sum: {
          heldBalance: true,
          availableBalance: true,
        },
      }),
      prisma.auction.count({ where: { status: AuctionStatus.LIVE } }),
      prisma.auction.count({
        where: {
          status: AuctionStatus.LIVE,
          endsAt: { gt: now, lte: endingSoonCutoff },
        },
      }),
      getQueueCounts(input.redisUrl, "email"),
      getQueueCounts(input.redisUrl, "auction-closer"),
    ]);

  return {
    serverTime: now.toISOString(),
    sockets: {
      active: activeSocketCount(input.io),
    },
    redis: redisHealth,
    postgres: postgresHealth,
    wallet: {
      totalHeldBalance: walletAgg._sum.heldBalance ?? 0,
      totalAvailableBalance: walletAgg._sum.availableBalance ?? 0,
    },
    auctions: {
      liveCount,
      endingSoonCount,
    },
    queues: {
      email: emailQueue,
      auctionCloser: closerQueue,
    },
  };
}

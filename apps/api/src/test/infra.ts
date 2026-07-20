import { Redis } from "ioredis";

const INFRA_TIMEOUT_MS = 5_000;

export function ensureDatabaseConnectTimeout(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "5");
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export function createTestRedis(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: INFRA_TIMEOUT_MS,
    commandTimeout: INFRA_TIMEOUT_MS,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fail fast when Postgres/Redis are unavailable — integration tests require both. */
export async function assertTestInfra(databaseUrl: string, redisUrl: string): Promise<void> {
  const redis = createTestRedis(redisUrl);
  try {
    await withTimeout(redis.connect(), INFRA_TIMEOUT_MS, "Redis connect");
    await withTimeout(redis.ping(), INFRA_TIMEOUT_MS, "Redis ping");
  } catch {
    throw new Error(
      `Integration tests require Redis at ${redisUrl}. Start with: docker compose up -d redis`,
    );
  } finally {
    redis.disconnect();
  }

  const { prisma } = await import("@auction/db");
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, INFRA_TIMEOUT_MS, "PostgreSQL query");
  } catch {
    throw new Error(
      "Integration tests require PostgreSQL (DATABASE_URL). Start with: docker compose up -d postgres && pnpm db:deploy",
    );
  }
}

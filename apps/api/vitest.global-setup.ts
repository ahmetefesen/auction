import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { assertTestInfra, ensureDatabaseConnectTimeout } from "./src/test/infra.js";

export async function setup(): Promise<void> {
  loadDotenv({ path: resolve(process.cwd(), "../../.env") });
  loadDotenv({ path: resolve(process.cwd(), ".env") });

  process.env["NODE_ENV"] = "test";

  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl) {
    process.env["DATABASE_URL"] = ensureDatabaseConnectTimeout(databaseUrl);
  }

  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const resolvedDatabaseUrl = process.env["DATABASE_URL"];
  if (!resolvedDatabaseUrl) {
    throw new Error("Integration tests require DATABASE_URL in .env");
  }

  await assertTestInfra(resolvedDatabaseUrl, redisUrl);
}

export async function teardown(): Promise<void> {
  const { prisma } = await import("@auction/db");
  await prisma.$disconnect();
}

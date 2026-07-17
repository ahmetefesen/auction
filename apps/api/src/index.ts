import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { Redis } from "ioredis";
import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { createSocketServer } from "./realtime/socket.js";
import { EventBus } from "./realtime/event-bus.js";
import { EmailQueue, startEmailWorker } from "./queues/email.js";
import { startAuctionCloser } from "./queues/auction-closer.js";

loadDotenv({ path: resolve(process.cwd(), "../../.env") });
loadDotenv({ path: resolve(process.cwd(), ".env") });

async function main(): Promise<void> {
  const env = loadEnv();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const emailQueue = new EmailQueue(env.REDIS_URL);
  const eventBus = new EventBus(redis);

  const app = await buildApp({ env, eventBus, emailQueue, redis });
  await app.listen({ port: env.API_PORT, host: env.API_HOST });

  const { io, pubClient, subClient } = await createSocketServer(app.server, env);
  eventBus.attachIo(io);
  eventBus.startSubscriber(subClient.duplicate());

  const emailWorker = startEmailWorker(env);
  const closer = startAuctionCloser(env.REDIS_URL, eventBus, emailQueue);

  app.log.info(`API listening on http://${env.API_HOST}:${env.API_PORT}`);

  const shutdown = async (): Promise<void> => {
    await closer.worker.close();
    await closer.queue.close();
    await emailWorker.close();
    await emailQueue.close();
    await app.close();
    pubClient.disconnect();
    subClient.disconnect();
    redis.disconnect();
  };

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

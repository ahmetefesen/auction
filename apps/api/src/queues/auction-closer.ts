import { Queue, Worker } from "bullmq";
import { prisma, AuctionStatus } from "@auction/db";
import { endAndSettleAuction } from "../services/auction.js";
import { expireNegotiationIfDue } from "../services/negotiation.js";
import type { EventBus } from "../realtime/event-bus.js";
import type { EmailQueue } from "./email.js";

const QUEUE_NAME = "auction-closer";

/**
 * AuctionCloserWorker — ticks every 1s.
 * LIVE + endsAt <= now → settle / negotiate; NEGOTIATING expired → release + ENDED.
 */
export function startAuctionCloser(
  redisUrl: string,
  eventBus: EventBus,
  emailQueue: EmailQueue,
): { queue: Queue; worker: Worker } {
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const queue = new Queue(QUEUE_NAME, { connection });
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const due = await prisma.auction.findMany({
        where: {
          status: AuctionStatus.LIVE,
          endsAt: { lte: new Date() },
        },
        select: { id: true },
        take: 50,
      });
      for (const a of due) {
        await endAndSettleAuction(a.id, eventBus, emailQueue);
      }

      const negotiatingDue = await prisma.auction.findMany({
        where: {
          status: AuctionStatus.NEGOTIATING,
          negotiationExpiresAt: { lte: new Date() },
        },
        select: { id: true },
        take: 50,
      });
      for (const a of negotiatingDue) {
        await expireNegotiationIfDue(a.id, eventBus);
      }

      await prisma.auction.updateMany({
        where: {
          status: AuctionStatus.SCHEDULED,
          startsAt: { lte: new Date() },
        },
        data: { status: AuctionStatus.LIVE },
      });

      const soon = await prisma.auction.findMany({
        where: {
          status: AuctionStatus.LIVE,
          endsAt: {
            gt: new Date(),
            lte: new Date(Date.now() + 15 * 60_000),
          },
        },
        select: { id: true, title: true, endsAt: true },
        take: 50,
      });
      for (const a of soon) {
        const watchers = await prisma.watchlist.findMany({
          where: { auctionId: a.id },
          select: { userId: true },
        });
        for (const w of watchers) {
          await emailQueue.addEndingSoon({
            userId: w.userId,
            auctionId: a.id,
            auctionTitle: a.title,
            endsAt: a.endsAt.toISOString(),
          });
        }
      }
    },
    { connection },
  );

  void queue.add(
    "tick",
    {},
    {
      repeat: { every: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
      jobId: "auction-closer-tick",
    },
  );

  return { queue, worker };
}

import { Queue, Worker, type Job } from "bullmq";
import nodemailer from "nodemailer";
import { prisma } from "@auction/db";
import { formatMoney } from "@auction/shared";
import type { Env } from "../config/env.js";

export type OutbidJob = {
  type: "OUTBID";
  userId: string;
  auctionId: string;
  auctionTitle: string;
  currentBidCents: number;
};

export type WonJob = {
  type: "AUCTION_WON";
  userId: string;
  auctionId: string;
  auctionTitle: string;
  amountCents: number;
};

export type EndingSoonJob = {
  type: "ENDING_SOON";
  userId: string;
  auctionId: string;
  auctionTitle: string;
  endsAt: string;
};

export type LiveJob = {
  type: "live";
  auctionId: string;
  auctionTitle: string;
};

export type EmailJob = OutbidJob | WonJob | EndingSoonJob | LiveJob;

const QUEUE_NAME = "email";

function bullConnection(redisUrl: string): { url: string; maxRetriesPerRequest: null } {
  return { url: redisUrl, maxRetriesPerRequest: null };
}

export class EmailQueue {
  private readonly queue: Queue<EmailJob>;

  constructor(redisUrl: string) {
    this.queue = new Queue<EmailJob>(QUEUE_NAME, {
      connection: bullConnection(redisUrl),
    });
  }

  async addOutbid(data: Omit<OutbidJob, "type">): Promise<void> {
    await this.queue.add("OUTBID", { type: "OUTBID", ...data });
  }

  async addWon(data: Omit<WonJob, "type">): Promise<void> {
    await this.queue.add("AUCTION_WON", { type: "AUCTION_WON", ...data });
  }

  async addEndingSoon(data: Omit<EndingSoonJob, "type">): Promise<void> {
    await this.queue.add(
      "ENDING_SOON",
      { type: "ENDING_SOON", ...data },
      {
        jobId: `ending-soon:${data.auctionId}:${data.userId}`,
        removeOnComplete: true,
      },
    );
  }

  async addAuctionLive(data: Omit<LiveJob, "type">): Promise<void> {
    await this.queue.add("live", { type: "live", ...data });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function startEmailWorker(env: Env): Worker<EmailJob> {
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  return new Worker<EmailJob>(
    QUEUE_NAME,
    async (job: Job<EmailJob>) => {
      try {
        const data = job.data;
        if (data.type === "live") {
          await transporter.sendMail({
            from: env.SMTP_FROM,
            to: env.SMTP_FROM,
            subject: `Auction live: ${data.auctionTitle}`,
            text: `Auction ${data.auctionId} is now live: ${data.auctionTitle}`,
          });
          return;
        }

        const user = await prisma.user.findUnique({ where: { id: data.userId } });
        if (!user) return;

        if (data.type === "OUTBID") {
          await transporter.sendMail({
            from: env.SMTP_FROM,
            to: user.email,
            subject: `[OUTBID] ${data.auctionTitle}`,
            text: `You were outbid on "${data.auctionTitle}". Current bid: ${formatMoney(data.currentBidCents, env.CURRENCY)}`,
          });
          return;
        }

        if (data.type === "ENDING_SOON") {
          await transporter.sendMail({
            from: env.SMTP_FROM,
            to: user.email,
            subject: `[ENDING_SOON] ${data.auctionTitle}`,
            text: `"${data.auctionTitle}" ends at ${data.endsAt}. Place your bid soon.`,
          });
          return;
        }

        await transporter.sendMail({
          from: env.SMTP_FROM,
          to: user.email,
          subject: `[AUCTION_WON] ${data.auctionTitle}`,
          text: `Congratulations! You won "${data.auctionTitle}" for ${formatMoney(data.amountCents, env.CURRENCY)}.`,
        });
      } catch (err) {
        console.warn("[email]", err instanceof Error ? err.message : err);
      }
    },
    { connection: bullConnection(env.REDIS_URL) },
  );
}

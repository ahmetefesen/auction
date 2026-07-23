import type { Prisma } from "@auction/db";
import { AuctionEventType } from "@auction/db";

export function elapsedSecFromStart(startsAt: Date, at: Date = new Date()): number {
  return Math.max(0, Math.floor((at.getTime() - startsAt.getTime()) / 1000));
}

export function remainingSecAt(endsAt: Date, at: Date = new Date()): number {
  return Math.max(0, Math.floor((endsAt.getTime() - at.getTime()) / 1000));
}

export async function recordAuctionEvent(
  tx: Prisma.TransactionClient,
  input: {
    auctionId: string;
    type: AuctionEventType;
    actorUserId?: string | null;
    payload?: Prisma.InputJsonValue;
    startsAt: Date;
    at?: Date;
  },
): Promise<void> {
  const at = input.at ?? new Date();
  await tx.auctionEvent.create({
    data: {
      auctionId: input.auctionId,
      type: input.type,
      actorUserId: input.actorUserId ?? null,
      payload: input.payload ?? undefined,
      elapsedSecFromStart: elapsedSecFromStart(input.startsAt, at),
    },
  });
}

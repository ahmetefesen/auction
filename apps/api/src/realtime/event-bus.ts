import type { Redis } from "ioredis";
import type { Server } from "socket.io";
import {
  RealtimeEvent,
  auctionRoom,
  userRoom,
  sellerRoom,
  bidPlacedPayloadSchema,
  auctionExtendedPayloadSchema,
  auctionEndedPayloadSchema,
  auctionSettledPayloadSchema,
  auctionNegotiatingPayloadSchema,
  walletUpdatedPayloadSchema,
  type BidPlacedPayload,
  type AuctionExtendedPayload,
  type AuctionEndedPayload,
  type AuctionSettledPayload,
  type AuctionNegotiatingPayload,
  type WalletUpdatedPayload,
} from "@auction/shared";

export type DomainPayload =
  | { event: typeof RealtimeEvent.BID_PLACED; data: BidPlacedPayload }
  | { event: typeof RealtimeEvent.AUCTION_EXTENDED; data: AuctionExtendedPayload }
  | { event: typeof RealtimeEvent.AUCTION_ENDED; data: AuctionEndedPayload }
  | { event: typeof RealtimeEvent.AUCTION_SETTLED; data: AuctionSettledPayload }
  | { event: typeof RealtimeEvent.AUCTION_NEGOTIATING; data: AuctionNegotiatingPayload }
  | { event: typeof RealtimeEvent.WALLET_UPDATED; data: WalletUpdatedPayload };

const CHANNEL = "auction:events";

export class EventBus {
  private io: Server | null = null;

  constructor(private readonly redis: Redis) {}

  attachIo(io: Server): void {
    this.io = io;
  }

  async publish(
    event: DomainPayload["event"],
    data: DomainPayload["data"],
  ): Promise<void> {
    // Redis-only fan-out: every API process (including publisher) emits once via subscriber.
    // Do not call emitLocal here — that caused double delivery to Socket.IO rooms.
    const envelope = { event, data };
    await this.redis.publish(CHANNEL, JSON.stringify(envelope));
  }

  startSubscriber(subscriber: Redis): void {
    void subscriber.subscribe(CHANNEL);
    subscriber.on("message", (channel, message) => {
      if (channel !== CHANNEL) return;
      this.handleMessage(message);
    });
  }

  private handleMessage(message: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    if (!("event" in parsed) || !("data" in parsed)) return;
    const event = parsed.event;
    const data = parsed.data;
    if (typeof event !== "string") return;
    this.emitLocal(event, data);
  }

  private emitLocal(event: string, data: unknown): void {
    if (!this.io) return;
    switch (event) {
      case RealtimeEvent.BID_PLACED: {
        const payload = bidPlacedPayloadSchema.safeParse(data);
        if (!payload.success) return;
        this.io.to(auctionRoom(payload.data.auctionId)).emit(event, payload.data);
        this.io.to(sellerRoom(payload.data.sellerId)).emit(event, payload.data);
        return;
      }
      case RealtimeEvent.AUCTION_EXTENDED: {
        const payload = auctionExtendedPayloadSchema.safeParse(data);
        if (!payload.success) return;
        this.io.to(auctionRoom(payload.data.auctionId)).emit(event, payload.data);
        return;
      }
      case RealtimeEvent.AUCTION_ENDED: {
        const payload = auctionEndedPayloadSchema.safeParse(data);
        if (!payload.success) return;
        this.io.to(auctionRoom(payload.data.auctionId)).emit(event, payload.data);
        return;
      }
      case RealtimeEvent.AUCTION_SETTLED: {
        const payload = auctionSettledPayloadSchema.safeParse(data);
        if (!payload.success) return;
        this.io.to(auctionRoom(payload.data.auctionId)).emit(event, payload.data);
        return;
      }
      case RealtimeEvent.AUCTION_NEGOTIATING: {
        const payload = auctionNegotiatingPayloadSchema.safeParse(data);
        if (!payload.success) return;
        this.io.to(auctionRoom(payload.data.auctionId)).emit(event, payload.data);
        return;
      }
      case RealtimeEvent.WALLET_UPDATED: {
        const payload = walletUpdatedPayloadSchema.safeParse(data);
        if (!payload.success) return;
        this.io.to(userRoom(payload.data.userId)).emit(event, payload.data);
        return;
      }
      default:
        return;
    }
  }
}

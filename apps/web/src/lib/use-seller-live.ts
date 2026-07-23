"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { RealtimeEvent, type BidPlacedPayload } from "@auction/shared";
import { API_URL } from "@/lib/api";

export type SellerLiveBidUpdate = {
  auctionId: string;
  currentBidCents: number;
  currentWinnerId: string | null;
  endsAt: string;
};

/**
 * Subscribes to bid.placed on the seller:{userId} room (server joins on connect).
 * Call onUpdate to patch desk list rows without a full reload.
 */
export function useSellerLive(
  sellerId: string | null,
  onUpdate: (update: SellerLiveBidUpdate) => void,
): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!sellerId) return;

    const socket: Socket = io(API_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socket.on(RealtimeEvent.BID_PLACED, (payload: BidPlacedPayload) => {
      if (payload.sellerId !== sellerId) return;
      onUpdateRef.current({
        auctionId: payload.auctionId,
        currentBidCents: payload.currentBidCents,
        currentWinnerId: payload.currentWinnerId,
        endsAt: payload.endsAt,
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [sellerId]);
}

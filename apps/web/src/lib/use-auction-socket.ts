"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  RealtimeEvent,
  type BidPlacedPayload,
  type AuctionExtendedPayload,
  type AuctionEndedPayload,
} from "@auction/shared";
import { API_URL } from "./api";

export type LiveBid = {
  id: string;
  bidderId: string;
  amount: number;
  isProxy: boolean;
  createdAt: string;
};

export function useAuctionSocket(auctionId: string | null) {
  const [currentBid, setCurrentBid] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [outbidFlash, setOutbidFlash] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [liveBids, setLiveBids] = useState<LiveBid[]>([]);
  const [ended, setEnded] = useState(false);
  const prevWinner = useRef<string | null>(null);

  const syncClock = useCallback(async () => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${API_URL}/health`, { credentials: "include" });
      const t1 = Date.now();
      const dateHeader = res.headers.get("date");
      if (dateHeader) {
        const serverMs = new Date(dateHeader).getTime();
        const rtt = t1 - t0;
        setServerOffsetMs(serverMs + rtt / 2 - t1);
      }
    } catch {
      // keep local clock
    }
  }, []);

  useEffect(() => {
    void syncClock();
    const id = window.setInterval(() => void syncClock(), 30_000);
    return () => window.clearInterval(id);
  }, [syncClock]);

  useEffect(() => {
    if (!auctionId) return;

    void fetch(`${API_URL}/auctions/${auctionId}/bids`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return;
        const data: unknown = await r.json();
        if (data && typeof data === "object" && "bids" in data && Array.isArray(data.bids)) {
          setLiveBids(
            data.bids.map((b: { id: string; bidderId: string; amount: number; isProxy: boolean; createdAt: string }) => ({
              id: b.id,
              bidderId: b.bidderId,
              amount: b.amount,
              isProxy: b.isProxy,
              createdAt: b.createdAt,
            })),
          );
        }
      })
      .catch(() => undefined);

    const socket: Socket = io(API_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      socket.emit("auction:join", auctionId);
    });

    socket.on(RealtimeEvent.BID_PLACED, (payload: BidPlacedPayload) => {
      if (payload.auctionId !== auctionId) return;
      if (
        prevWinner.current &&
        payload.currentWinnerId &&
        prevWinner.current !== payload.currentWinnerId
      ) {
        setOutbidFlash(true);
        window.setTimeout(() => setOutbidFlash(false), 2500);
      }
      prevWinner.current = payload.currentWinnerId;
      setCurrentBid(payload.currentBidCents);
      setEndsAt(payload.endsAt);
      setWinnerId(payload.currentWinnerId);
      setLiveBids((prev) => [
        {
          id: payload.bidId,
          bidderId: payload.bidderId,
          amount: payload.currentBidCents,
          isProxy: payload.isProxy,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    });

    socket.on(RealtimeEvent.AUCTION_EXTENDED, (payload: AuctionExtendedPayload) => {
      if (payload.auctionId !== auctionId) return;
      setEndsAt(payload.endsAt);
    });

    socket.on(RealtimeEvent.AUCTION_ENDED, (payload: AuctionEndedPayload) => {
      if (payload.auctionId !== auctionId) return;
      setEnded(true);
      setWinnerId(payload.winnerId);
      setCurrentBid(payload.finalBidCents);
    });

    return () => {
      socket.emit("auction:leave", auctionId);
      socket.disconnect();
    };
  }, [auctionId]);

  return {
    currentBid,
    endsAt,
    winnerId,
    outbidFlash,
    serverOffsetMs,
    liveBids,
    ended,
  };
}

export function useSyncedNow(serverOffsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + serverOffsetMs);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + serverOffsetMs), 100);
    return () => window.clearInterval(t);
  }, [serverOffsetMs]);
  return now;
}

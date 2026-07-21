"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { io, type Socket } from "socket.io-client";
import {
  RealtimeEvent,
  type AuctionSnapshotDto,
  type BidPlacedPayload,
  type AuctionExtendedPayload,
  type AuctionEndedPayload,
  type AuctionNegotiatingPayload,
  type AuctionSettledPayload,
  type WalletDto,
  type WalletUpdatedPayload,
} from "@auction/shared";
import { API_URL } from "./api";

export type LiveBid = {
  id: string;
  bidderId: string;
  amount: number;
  isProxy: boolean;
  createdAt: string;
};

export type ConnectionQuality = "good" | "ok" | "poor" | "offline";

function qualityFromLatency(latencyMs: number | null, connected: boolean): ConnectionQuality {
  if (!connected) return "offline";
  if (latencyMs == null) return "ok";
  if (latencyMs < 100) return "good";
  if (latencyMs < 300) return "ok";
  return "poor";
}

function applySnapshotToState(
  data: AuctionSnapshotDto,
  setters: {
    setCurrentBid: (v: number) => void;
    setEndsAt: (v: string) => void;
    setWinnerId: (v: string | null) => void;
    setLiveBids: (v: LiveBid[]) => void;
    setEnded: (v: boolean) => void;
    setSettled: (v: boolean) => void;
    setNegotiating: (v: boolean) => void;
    setNegotiationExpiresAt: (v: string | null) => void;
    setCounterOfferCents: (v: number | null) => void;
    setWallet: (v: WalletDto | null) => void;
    setServerOffsetMs: (v: number) => void;
    prevWinner: MutableRefObject<string | null>;
  },
): void {
  setters.setCurrentBid(data.auction.currentBid);
  setters.setEndsAt(data.auction.endsAt);
  setters.setWinnerId(data.auction.currentWinnerId);
  setters.setLiveBids(
    data.bids.map((b) => ({
      id: b.id,
      bidderId: b.bidderId,
      amount: b.amount,
      isProxy: b.isProxy,
      createdAt: b.createdAt,
    })),
  );
  setters.setSettled(data.auction.status === "SETTLED");
  setters.setEnded(
    data.auction.status === "ENDED" || data.auction.status === "SETTLED",
  );
  setters.setNegotiating(data.auction.status === "NEGOTIATING");
  setters.setNegotiationExpiresAt(data.auction.negotiationExpiresAt ?? null);
  setters.setCounterOfferCents(data.auction.counterOfferCents ?? null);
  setters.setWallet(data.wallet);
  setters.prevWinner.current = data.auction.currentWinnerId;
  const serverMs = new Date(data.serverTime).getTime();
  setters.setServerOffsetMs(serverMs - Date.now());
}

export function useAuctionSocket(
  auctionId: string | null,
  onSnapshotSync?: () => void,
) {
  const [currentBid, setCurrentBid] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [outbidFlash, setOutbidFlash] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [liveBids, setLiveBids] = useState<LiveBid[]>([]);
  const [ended, setEnded] = useState(false);
  const [settled, setSettled] = useState(false);
  const [negotiating, setNegotiating] = useState(false);
  const [negotiationExpiresAt, setNegotiationExpiresAt] = useState<string | null>(null);
  const [counterOfferCents, setCounterOfferCents] = useState<number | null>(null);
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [extendedFlash, setExtendedFlash] = useState(false);
  const prevWinner = useRef<string | null>(null);
  const onSnapshotSyncRef = useRef(onSnapshotSync);
  onSnapshotSyncRef.current = onSnapshotSync;

  const syncClockAndLatency = useCallback(async () => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${API_URL}/health`, { credentials: "include" });
      const t1 = Date.now();
      const rtt = t1 - t0;
      setLatencyMs(rtt);
      const dateHeader = res.headers.get("date");
      if (dateHeader) {
        const serverMs = new Date(dateHeader).getTime();
        setServerOffsetMs(serverMs + rtt / 2 - t1);
      }
    } catch {
      setLatencyMs(null);
    }
  }, []);

  const fetchSnapshot = useCallback(async (): Promise<void> => {
    if (!auctionId) return;
    try {
      const res = await fetch(`${API_URL}/auctions/${auctionId}/snapshot`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as AuctionSnapshotDto;
      applySnapshotToState(data, {
        setCurrentBid,
        setEndsAt,
        setWinnerId,
        setLiveBids,
        setEnded,
        setSettled,
        setNegotiating,
        setNegotiationExpiresAt,
        setCounterOfferCents,
        setWallet,
        setServerOffsetMs,
        prevWinner,
      });
      setSyncedAt(Date.now());
      onSnapshotSyncRef.current?.();
    } catch {
      // keep last known state until next reconnect attempt
    }
  }, [auctionId]);

  useEffect(() => {
    void syncClockAndLatency();
    const id = window.setInterval(() => void syncClockAndLatency(), 15_000);
    return () => window.clearInterval(id);
  }, [syncClockAndLatency]);

  useEffect(() => {
    if (!auctionId) return;

    void fetchSnapshot();

    const socket: Socket = io(API_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    const handleConnect = (): void => {
      setConnected(true);
      socket.emit("auction:join", auctionId);
      void fetchSnapshot();
      void syncClockAndLatency();
    };

    const handleDisconnect = (): void => {
      setConnected(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.io.on("reconnect", handleConnect);

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
        ...prev.filter((b) => b.id !== payload.bidId),
      ]);
      onSnapshotSyncRef.current?.();
    });

    socket.on(RealtimeEvent.AUCTION_EXTENDED, (payload: AuctionExtendedPayload) => {
      if (payload.auctionId !== auctionId) return;
      setEndsAt(payload.endsAt);
      setExtendedFlash(true);
      window.setTimeout(() => setExtendedFlash(false), 3000);
    });

    socket.on(RealtimeEvent.AUCTION_ENDED, (payload: AuctionEndedPayload) => {
      if (payload.auctionId !== auctionId) return;
      setEnded(true);
      setNegotiating(false);
      setWinnerId(payload.winnerId);
      setCurrentBid(payload.finalBidCents);
    });

    socket.on(RealtimeEvent.AUCTION_SETTLED, (payload: AuctionSettledPayload) => {
      if (payload.auctionId !== auctionId) return;
      setSettled(true);
      setEnded(true);
      setNegotiating(false);
      setWinnerId(payload.winnerId);
      setCurrentBid(payload.amountCents);
    });

    socket.on(RealtimeEvent.AUCTION_NEGOTIATING, (payload: AuctionNegotiatingPayload) => {
      if (payload.auctionId !== auctionId) return;
      setNegotiating(true);
      setEnded(false);
      setSettled(false);
      setCurrentBid(payload.currentBidCents);
      setWinnerId(payload.currentWinnerId);
      setNegotiationExpiresAt(payload.negotiationExpiresAt);
      setCounterOfferCents(payload.counterOfferCents);
    });

    socket.on(RealtimeEvent.WALLET_UPDATED, (payload: WalletUpdatedPayload) => {
      setWallet({
        availableBalance: payload.availableBalance,
        heldBalance: payload.heldBalance,
      });
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.io.off("reconnect", handleConnect);
      socket.emit("auction:leave", auctionId);
      socket.disconnect();
    };
  }, [auctionId, fetchSnapshot, syncClockAndLatency]);

  const connectionQuality = qualityFromLatency(latencyMs, connected);

  return {
    currentBid,
    endsAt,
    winnerId,
    outbidFlash,
    extendedFlash,
    serverOffsetMs,
    liveBids,
    ended,
    settled,
    negotiating,
    negotiationExpiresAt,
    counterOfferCents,
    wallet,
    syncedAt,
    connected,
    latencyMs,
    connectionQuality,
    refetchSnapshot: fetchSnapshot,
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

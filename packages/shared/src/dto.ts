import type { AuctionStatus, Role, UserStatus } from "./roles.js";
import type { ErrorResponse } from "./schemas.js";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  /** All roles assigned to this user (BUYER + SELLER allowed). */
  roles: Role[];
  status: UserStatus;
  createdAt: string;
};

export type WalletDto = {
  availableBalance: number;
  heldBalance: number;
};

export type AuctionImageDto = {
  id: string;
  url: string;
  sortOrder: number;
};

export type AuctionDto = {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  status: AuctionStatus;
  startingPrice: number;
  reservePrice: number | null;
  reserveMet: boolean | null;
  buyNowPrice: number | null;
  minIncrement: number;
  currentBid: number;
  currentWinnerId: string | null;
  startsAt: string;
  endsAt: string;
  negotiationExpiresAt: string | null;
  counterOfferCents: number | null;
  images: AuctionImageDto[];
  createdAt: string;
  updatedAt: string;
};

export type BidDto = {
  id: string;
  auctionId: string;
  bidderId: string;
  amount: number;
  isProxy: boolean;
  sequenceNo: number;
  elapsedSecFromStart: number;
  remainingSecAtBid: number;
  createdAt: string;
};

/** Live auction state for reconnect / catch-up sync */
export type AuctionSnapshotDto = {
  serverTime: string;
  auction: {
    id: string;
    status: AuctionStatus;
    currentBid: number;
    currentWinnerId: string | null;
    endsAt: string;
    version: number;
    minIncrement: number;
    startingPrice: number;
    antiSnipeWindowSec: number;
    antiSnipeExtendSec: number;
    negotiationExpiresAt?: string | null;
    counterOfferCents?: number | null;
  };
  bids: BidDto[];
  wallet: WalletDto | null;
};

export type QueueJobCountsDto = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
};

/** Admin ops dashboard metrics */
export type AdminMetricsDto = {
  serverTime: string;
  sockets: {
    active: number | null;
  };
  redis: {
    latencyMs: number | null;
    ok: boolean;
  };
  postgres: {
    latencyMs: number | null;
    ok: boolean;
  };
  wallet: {
    totalHeldBalance: number;
    totalAvailableBalance: number;
  };
  auctions: {
    liveCount: number;
    endingSoonCount: number;
  };
  queues: {
    email: QueueJobCountsDto | null;
    auctionCloser: QueueJobCountsDto | null;
  };
};

/** Read-only bid preview for Smart Bid Helper (no writes). */
export type BidPreviewDto = {
  auctionId: string;
  amountCents: number;
  minRequiredCents: number;
  meetsMinimum: boolean;
  becomesLeader: boolean;
  wouldExtend: boolean;
  extendedEndsAt: string | null;
  holdDeltaCents: number;
  availableBalanceCents: number;
  insufficientFunds: boolean;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** @deprecated Prefer ErrorResponse from schemas */
export type ApiErrorBody = ErrorResponse;

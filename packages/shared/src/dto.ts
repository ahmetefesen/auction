import type { AuctionStatus, Role, UserStatus } from "./roles.js";
import type { ErrorResponse } from "./schemas.js";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
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
  createdAt: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** @deprecated Prefer ErrorResponse from schemas */
export type ApiErrorBody = ErrorResponse;

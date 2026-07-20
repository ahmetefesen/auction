export const Role = {
  ADMIN: "ADMIN",
  SELLER: "SELLER",
  BUYER: "BUYER",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ROLES: readonly Role[] = [Role.ADMIN, Role.SELLER, Role.BUYER];

export const UserStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const AuctionStatus = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  NEGOTIATING: "NEGOTIATING",
  ENDED: "ENDED",
  CANCELLED: "CANCELLED",
  SETTLED: "SETTLED",
} as const;

export type AuctionStatus = (typeof AuctionStatus)[keyof typeof AuctionStatus];

export const WalletTxType = {
  DEPOSIT: "DEPOSIT",
  HOLD: "HOLD",
  RELEASE: "RELEASE",
  CAPTURE: "CAPTURE",
  REFUND: "REFUND",
  WITHDRAW: "WITHDRAW",
} as const;

export type WalletTxType = (typeof WalletTxType)[keyof typeof WalletTxType];

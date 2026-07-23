export const Role = {
  ADMIN: "ADMIN",
  SELLER: "SELLER",
  BUYER: "BUYER",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ROLES: readonly Role[] = [Role.ADMIN, Role.SELLER, Role.BUYER];

/** Self-serve registration may only claim these roles (not ADMIN). */
export const REGISTERABLE_ROLES: readonly Role[] = [Role.SELLER, Role.BUYER];

export function hasRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role);
}

export function hasAnyRole(roles: readonly Role[], ...needed: readonly Role[]): boolean {
  return needed.some((r) => roles.includes(r));
}

export function rolesEqual(a: readonly Role[], b: readonly Role[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((r, i) => r === sb[i]);
}

export function sortRoles(roles: readonly Role[]): Role[] {
  const order: Record<Role, number> = { ADMIN: 0, SELLER: 1, BUYER: 2 };
  return [...roles].sort((x, y) => order[x] - order[y]);
}

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

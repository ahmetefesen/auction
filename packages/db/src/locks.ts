import { Prisma, type Auction, type ProxyBid, type Wallet } from "@prisma/client";

export type LockedAuction = Auction;
export type LockedWallet = Wallet;
export type LockedProxyBid = ProxyBid;

type Tx = Prisma.TransactionClient;

/**
 * Pessimistic row lock via PostgreSQL `SELECT … FOR UPDATE`.
 * Must be called inside an open transaction.
 */
export async function lockAuctionById(tx: Tx, auctionId: string): Promise<LockedAuction | null> {
  const rows = await tx.$queryRaw<LockedAuction[]>(
    Prisma.sql`SELECT * FROM "Auction" WHERE id = ${auctionId}::uuid FOR UPDATE`,
  );
  return rows[0] ?? null;
}

export async function lockWalletByUserId(tx: Tx, userId: string): Promise<LockedWallet | null> {
  const rows = await tx.$queryRaw<LockedWallet[]>(
    Prisma.sql`SELECT * FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`,
  );
  return rows[0] ?? null;
}

export async function lockWalletsByUserIds(tx: Tx, userIds: readonly string[]): Promise<LockedWallet[]> {
  const uniqueSorted = [...new Set(userIds)].sort();
  if (uniqueSorted.length === 0) {
    return [];
  }
  return tx.$queryRaw<LockedWallet[]>(
    Prisma.sql`SELECT * FROM "Wallet" WHERE "userId" IN (${Prisma.join(
      uniqueSorted.map((id) => Prisma.sql`${id}::uuid`),
    )}) ORDER BY "userId" ASC FOR UPDATE`,
  );
}

export async function lockProxyBidsForAuction(tx: Tx, auctionId: string): Promise<LockedProxyBid[]> {
  return tx.$queryRaw<LockedProxyBid[]>(
    Prisma.sql`SELECT * FROM "ProxyBid" WHERE "auctionId" = ${auctionId}::uuid ORDER BY "bidderId" ASC FOR UPDATE`,
  );
}

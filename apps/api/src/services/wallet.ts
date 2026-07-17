import {
  prisma,
  WalletTxType,
  lockWalletByUserId,
  lockWalletsByUserIds,
  Prisma,
  type LockedWallet,
} from "@auction/db";
import { AppError } from "../lib/errors.js";

type Tx = Prisma.TransactionClient;

export type WalletSnapshot = {
  availableBalance: number;
  heldBalance: number;
  version: number;
};

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 15_000,
};

function assertPositiveIntAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError(400, "INVALID_AMOUNT", "Amount must be a positive integer (minor units)");
  }
}

/**
 * Financial escrow + immutable ledger.
 * Standalone methods run in Serializable transactions with pessimistic wallet locks.
 * `*InTx` variants nest inside an outer auction transaction (same lock semantics).
 */
export class WalletService {
  async deposit(userId: string, amount: number): Promise<WalletSnapshot> {
    assertPositiveIntAmount(amount);
    return prisma.$transaction(async (tx) => this.depositInTx(tx, userId, amount), SERIALIZABLE);
  }

  async holdForBid(userId: string, auctionId: string, amount: number): Promise<WalletSnapshot> {
    assertPositiveIntAmount(amount);
    return prisma.$transaction(
      async (tx) => this.holdForBidInTx(tx, userId, auctionId, amount),
      SERIALIZABLE,
    );
  }

  async releaseHold(userId: string, auctionId: string, amount: number): Promise<WalletSnapshot> {
    assertPositiveIntAmount(amount);
    return prisma.$transaction(
      async (tx) => this.releaseHoldInTx(tx, userId, auctionId, amount),
      SERIALIZABLE,
    );
  }

  async captureHold(
    buyerId: string,
    sellerId: string,
    auctionId: string,
    amount: number,
  ): Promise<void> {
    assertPositiveIntAmount(amount);
    await prisma.$transaction(
      async (tx) => this.captureHoldInTx(tx, buyerId, sellerId, auctionId, amount),
      SERIALIZABLE,
    );
  }

  /** Lock wallet via PostgreSQL SELECT … FOR UPDATE. */
  async depositInTx(tx: Tx, userId: string, amount: number): Promise<WalletSnapshot> {
    assertPositiveIntAmount(amount);
    const wallet = await this.requireLockedWallet(tx, userId);
    const availableBalance = wallet.availableBalance + amount;
    const heldBalance = wallet.heldBalance;
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.DEPOSIT,
        amount,
        balanceAfter: availableBalance,
        heldAfter: heldBalance,
        referenceType: "deposit",
        referenceId: null,
      },
    });
    return tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance, heldBalance, version: { increment: 1 } },
      select: { availableBalance: true, heldBalance: true, version: true },
    });
  }

  async holdForBidInTx(
    tx: Tx,
    userId: string,
    auctionId: string,
    amount: number,
  ): Promise<WalletSnapshot> {
    assertPositiveIntAmount(amount);
    const wallet = await this.requireLockedWallet(tx, userId);
    if (wallet.availableBalance < amount) {
      throw new AppError(400, "INSUFFICIENT_FUNDS", "Insufficient available balance");
    }
    const availableBalance = wallet.availableBalance - amount;
    const heldBalance = wallet.heldBalance + amount;
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.HOLD,
        amount,
        balanceAfter: availableBalance,
        heldAfter: heldBalance,
        referenceType: "auction",
        referenceId: auctionId,
      },
    });
    return tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance, heldBalance, version: { increment: 1 } },
      select: { availableBalance: true, heldBalance: true, version: true },
    });
  }

  async releaseHoldInTx(
    tx: Tx,
    userId: string,
    auctionId: string,
    amount: number,
  ): Promise<WalletSnapshot> {
    assertPositiveIntAmount(amount);
    const wallet = await this.requireLockedWallet(tx, userId);
    if (wallet.heldBalance < amount) {
      throw new AppError(400, "INVALID_HOLD", "Held balance too low to release");
    }
    const availableBalance = wallet.availableBalance + amount;
    const heldBalance = wallet.heldBalance - amount;
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.RELEASE,
        amount,
        balanceAfter: availableBalance,
        heldAfter: heldBalance,
        referenceType: "auction",
        referenceId: auctionId,
      },
    });
    return tx.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance, heldBalance, version: { increment: 1 } },
      select: { availableBalance: true, heldBalance: true, version: true },
    });
  }

  /**
   * Buyer CAPTURE (held ↓) + seller DEPOSIT (available ↑).
   * Locks both wallets in ascending userId order to avoid deadlocks.
   */
  async captureHoldInTx(
    tx: Tx,
    buyerId: string,
    sellerId: string,
    auctionId: string,
    amount: number,
  ): Promise<void> {
    assertPositiveIntAmount(amount);
    const wallets = await lockWalletsByUserIds(tx, [buyerId, sellerId]);
    const buyer = wallets.find((w) => w.userId === buyerId);
    const seller = wallets.find((w) => w.userId === sellerId);
    if (!buyer || !seller) {
      throw new AppError(404, "WALLET_NOT_FOUND", "Buyer or seller wallet missing");
    }
    if (buyer.heldBalance < amount) {
      throw new AppError(400, "INVALID_HOLD", "Buyer held balance too low to capture");
    }

    const buyerAvailable = buyer.availableBalance;
    const buyerHeld = buyer.heldBalance - amount;
    await tx.walletTransaction.create({
      data: {
        walletId: buyer.id,
        type: WalletTxType.CAPTURE,
        amount,
        balanceAfter: buyerAvailable,
        heldAfter: buyerHeld,
        referenceType: "auction",
        referenceId: auctionId,
      },
    });
    await tx.wallet.update({
      where: { id: buyer.id },
      data: {
        availableBalance: buyerAvailable,
        heldBalance: buyerHeld,
        version: { increment: 1 },
      },
    });

    const sellerAvailable = seller.availableBalance + amount;
    const sellerHeld = seller.heldBalance;
    await tx.walletTransaction.create({
      data: {
        walletId: seller.id,
        type: WalletTxType.DEPOSIT,
        amount,
        balanceAfter: sellerAvailable,
        heldAfter: sellerHeld,
        referenceType: "auction",
        referenceId: auctionId,
      },
    });
    await tx.wallet.update({
      where: { id: seller.id },
      data: {
        availableBalance: sellerAvailable,
        heldBalance: sellerHeld,
        version: { increment: 1 },
      },
    });
  }

  private async requireLockedWallet(tx: Tx, userId: string): Promise<LockedWallet> {
    const wallet = await lockWalletByUserId(tx, userId);
    if (!wallet) {
      throw new AppError(404, "WALLET_NOT_FOUND", "Wallet not found");
    }
    return wallet;
  }
}

export const walletService = new WalletService();

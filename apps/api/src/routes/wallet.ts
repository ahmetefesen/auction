import type { FastifyInstance } from "fastify";
import { prisma } from "@auction/db";
import { DepositSchema, RealtimeEvent } from "@auction/shared";
import { AppError } from "../lib/errors.js";
import { requireBuyer } from "../plugins/auth.js";
import { walletService } from "../services/wallet.js";

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.post("/wallets/deposit", { preHandler: requireBuyer }, async (request) => {
    const user = request.user;
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }
    const body = DepositSchema.parse(request.body);
    const updated = await walletService.deposit(user.id, body.amountCents);

    await app.eventBus.publish(RealtimeEvent.WALLET_UPDATED, {
      userId: user.id,
      availableBalance: updated.availableBalance,
      heldBalance: updated.heldBalance,
    });

    return {
      wallet: {
        availableBalance: updated.availableBalance,
        heldBalance: updated.heldBalance,
      },
    };
  });

  app.get("/wallets/me", { preHandler: requireBuyer }, async (request) => {
    const user = request.user;
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) {
      throw new AppError(404, "WALLET_NOT_FOUND", "Wallet not found");
    }
    const txs = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      wallet: {
        availableBalance: wallet.availableBalance,
        heldBalance: wallet.heldBalance,
      },
      transactions: txs.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        heldAfter: t.heldAfter,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  });
}

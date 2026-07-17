import argon2 from "argon2";
import { PrismaClient, Role, AuctionStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await argon2.hash("Password123!", {
    type: argon2.argon2id,
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@auction.local" },
    update: {},
    create: {
      email: "admin@auction.local",
      passwordHash,
      displayName: "Admin",
      role: Role.ADMIN,
      wallet: { create: {} },
    },
  });

  const seller = await prisma.user.upsert({
    where: { email: "seller@auction.local" },
    update: {},
    create: {
      email: "seller@auction.local",
      passwordHash,
      displayName: "Demo Seller",
      role: Role.SELLER,
      wallet: { create: {} },
    },
  });

  const buyer = await prisma.user.upsert({
    where: { email: "buyer@auction.local" },
    update: {},
    create: {
      email: "buyer@auction.local",
      passwordHash,
      displayName: "Demo Buyer",
      role: Role.BUYER,
      wallet: {
        create: {
          availableBalance: 500_000,
          heldBalance: 0,
        },
      },
    },
  });

  const buyer2 = await prisma.user.upsert({
    where: { email: "buyer2@auction.local" },
    update: {},
    create: {
      email: "buyer2@auction.local",
      passwordHash,
      displayName: "Demo Buyer 2",
      role: Role.BUYER,
      wallet: {
        create: {
          availableBalance: 500_000,
          heldBalance: 0,
        },
      },
    },
  });

  const startsAt = new Date(Date.now() - 60_000);
  const endsAt = new Date(Date.now() + 60 * 60_000);

  const existing = await prisma.auction.findFirst({
    where: { sellerId: seller.id, title: "Vintage Chronograph Watch" },
  });

  if (!existing) {
    await prisma.auction.create({
      data: {
        sellerId: seller.id,
        title: "Vintage Chronograph Watch",
        description:
          "A meticulously restored 1960s chronograph. Live auction with anti-sniping and escrow holds.",
        status: AuctionStatus.LIVE,
        startingPrice: 10_000,
        reservePrice: 25_000,
        minIncrement: 500,
        currentBid: 0,
        startsAt,
        endsAt,
      },
    });
  }

  console.log("Seed complete:");
  console.log({ admin: admin.email, seller: seller.email, buyer: buyer.email, buyer2: buyer2.email });
  console.log("Password for all: Password123!");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

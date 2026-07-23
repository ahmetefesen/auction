-- Multi-role UserRole + profiles + bid analytics + AuctionEvent timeline

-- CreateEnum
CREATE TYPE "AuctionEventType" AS ENUM ('BID_PLACED', 'EXTENDED', 'STATUS_CHANGED', 'SETTLED', 'NEGOTIATING');

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storeName" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuyerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuctionEvent" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "type" "AuctionEventType" NOT NULL,
    "actorUserId" UUID,
    "payload" JSONB,
    "elapsedSecFromStart" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionEvent_pkey" PRIMARY KEY ("id")
);

-- Bid analytics columns (nullable first for backfill)
ALTER TABLE "Bid" ADD COLUMN "sequenceNo" INTEGER;
ALTER TABLE "Bid" ADD COLUMN "elapsedSecFromStart" INTEGER;
ALTER TABLE "Bid" ADD COLUMN "remainingSecAtBid" INTEGER;

-- Backfill UserRole from legacy User.role
INSERT INTO "UserRole" ("id", "userId", "role", "createdAt")
SELECT gen_random_uuid(), u."id", u."role", u."createdAt"
FROM "User" u;

-- Profiles from legacy role
INSERT INTO "SellerProfile" ("id", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", NOW(), NOW()
FROM "User" u
WHERE u."role" = 'SELLER';

INSERT INTO "BuyerProfile" ("id", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", NOW(), NOW()
FROM "User" u
WHERE u."role" = 'BUYER';

INSERT INTO "AdminProfile" ("id", "userId", "permissions", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", '{}'::jsonb, NOW(), NOW()
FROM "User" u
WHERE u."role" = 'ADMIN';

-- Backfill bid sequence + timing features
WITH ordered AS (
  SELECT
    b."id",
    ROW_NUMBER() OVER (PARTITION BY b."auctionId" ORDER BY b."createdAt" ASC, b."id" ASC) AS seq,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (b."createdAt" - a."startsAt")))::int) AS elapsed,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (a."endsAt" - b."createdAt")))::int) AS remaining
  FROM "Bid" b
  INNER JOIN "Auction" a ON a."id" = b."auctionId"
)
UPDATE "Bid" b
SET
  "sequenceNo" = ordered.seq,
  "elapsedSecFromStart" = ordered.elapsed,
  "remainingSecAtBid" = ordered.remaining
FROM ordered
WHERE b."id" = ordered."id";

-- Empty auctions with no bids: nothing to do
UPDATE "Bid" SET "sequenceNo" = 1, "elapsedSecFromStart" = 0, "remainingSecAtBid" = 0
WHERE "sequenceNo" IS NULL;

ALTER TABLE "Bid" ALTER COLUMN "sequenceNo" SET NOT NULL;
ALTER TABLE "Bid" ALTER COLUMN "elapsedSecFromStart" SET NOT NULL;
ALTER TABLE "Bid" ALTER COLUMN "remainingSecAtBid" SET NOT NULL;

-- Drop legacy single role
DROP INDEX IF EXISTS "User_role_status_idx";
ALTER TABLE "User" DROP COLUMN "role";

-- Indexes & FKs
CREATE UNIQUE INDEX "UserRole_userId_role_key" ON "UserRole"("userId", "role");
CREATE INDEX "UserRole_role_idx" ON "UserRole"("role");
CREATE INDEX "User_status_idx" ON "User"("status");

CREATE UNIQUE INDEX "SellerProfile_userId_key" ON "SellerProfile"("userId");
CREATE UNIQUE INDEX "BuyerProfile_userId_key" ON "BuyerProfile"("userId");
CREATE UNIQUE INDEX "AdminProfile_userId_key" ON "AdminProfile"("userId");

CREATE UNIQUE INDEX "Bid_auctionId_sequenceNo_key" ON "Bid"("auctionId", "sequenceNo");

CREATE INDEX "AuctionEvent_auctionId_createdAt_idx" ON "AuctionEvent"("auctionId", "createdAt");
CREATE INDEX "AuctionEvent_type_createdAt_idx" ON "AuctionEvent"("type", "createdAt");
CREATE INDEX "AuctionEvent_actorUserId_idx" ON "AuctionEvent"("actorUserId");

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerProfile" ADD CONSTRAINT "BuyerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

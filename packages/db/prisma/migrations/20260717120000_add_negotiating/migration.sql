-- AlterEnum
ALTER TYPE "AuctionStatus" ADD VALUE 'NEGOTIATING';

-- AlterTable
ALTER TABLE "Auction" ADD COLUMN "negotiationExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN "counterOfferCents" INTEGER;

-- CreateIndex
CREATE INDEX "Auction_status_negotiationExpiresAt_idx" ON "Auction"("status", "negotiationExpiresAt");

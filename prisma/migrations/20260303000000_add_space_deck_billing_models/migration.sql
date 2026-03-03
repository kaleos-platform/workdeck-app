-- CreateEnum
CREATE TYPE "SpaceType" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'STARTER', 'PRO', 'TEAM');

-- CreateEnum
CREATE TYPE "SpaceMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- DropIndex
DROP INDEX "AdRecord_workspaceId_date_campaignId_adType_keyword_adGroup_key";

-- AlterTable
ALTER TABLE "AdRecord" DROP COLUMN "salesOptionId";

-- CreateTable
CREATE TABLE "ProductStatus" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "optionId" TEXT NOT NULL DEFAULT '',
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SpaceType" NOT NULL DEFAULT 'PERSONAL',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPlan" "PlanType" NOT NULL DEFAULT 'FREE',
    "planExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceMember" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SpaceMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeckApp" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DeckApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeckInstance" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "deckAppId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeckInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterEvent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "deckAppId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductStatus_workspaceId_campaignId_idx" ON "ProductStatus"("workspaceId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStatus_workspaceId_campaignId_productName_optionId_key" ON "ProductStatus"("workspaceId", "campaignId", "productName", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "Space_stripeCustomerId_key" ON "Space"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Space_stripeSubscriptionId_key" ON "Space"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "SpaceMember_userId_idx" ON "SpaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMember_spaceId_userId_key" ON "SpaceMember"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "DeckInstance_spaceId_idx" ON "DeckInstance"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeckInstance_spaceId_deckAppId_key" ON "DeckInstance"("spaceId", "deckAppId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_stripeEventId_key" ON "BillingEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "MeterEvent_spaceId_deckAppId_createdAt_idx" ON "MeterEvent"("spaceId", "deckAppId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdRecord_workspaceId_date_campaignId_adType_keyword_adGroup_key" ON "AdRecord"("workspaceId", "date", "campaignId", "adType", "keyword", "adGroup", "optionId");

-- AddForeignKey
ALTER TABLE "ProductStatus" ADD CONSTRAINT "ProductStatus_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckInstance" ADD CONSTRAINT "DeckInstance_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckInstance" ADD CONSTRAINT "DeckInstance_deckAppId_fkey" FOREIGN KEY ("deckAppId") REFERENCES "DeckApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterEvent" ADD CONSTRAINT "MeterEvent_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

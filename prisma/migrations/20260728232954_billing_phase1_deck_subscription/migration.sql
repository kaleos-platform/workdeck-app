-- CreateEnum
CREATE TYPE "DeckPricingMode" AS ENUM ('FREE_BETA', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionItemType" AS ENUM ('DECK', 'ADDON');

-- CreateEnum
CREATE TYPE "SubscriptionItemStatus" AS ENUM ('ACTIVE', 'CANCEL_AT_PERIOD_END', 'ENDED');

-- CreateEnum
CREATE TYPE "BillingChargeStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED');


-- CreateTable
CREATE TABLE "BillingDeckProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricingMode" "DeckPricingMode" NOT NULL DEFAULT 'FREE_BETA',
    "monthlyPrice" INTEGER NOT NULL,
    "paidActivatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingDeckProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceSubscription" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "exemptFlag" BOOLEAN NOT NULL DEFAULT false,
    "exemptNote" TEXT,
    "provider" TEXT,
    "customerKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionItem" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "SubscriptionItemType" NOT NULL DEFAULT 'DECK',
    "deckAppId" TEXT NOT NULL,
    "priceSnapshot" INTEGER NOT NULL,
    "status" "SubscriptionItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingMethod" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "billingKey" TEXT NOT NULL,
    "billingKeyIv" TEXT NOT NULL,
    "cardSummary" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCharge" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "supplyAmount" INTEGER NOT NULL,
    "vatAmount" INTEGER NOT NULL,
    "status" "BillingChargeStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "paymentKey" TEXT,
    "failReason" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceSubscription_spaceId_key" ON "SpaceSubscription"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceSubscription_customerKey_key" ON "SpaceSubscription"("customerKey");

-- CreateIndex
CREATE INDEX "SpaceSubscription_status_currentPeriodEnd_idx" ON "SpaceSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "SubscriptionItem_subscriptionId_status_idx" ON "SubscriptionItem"("subscriptionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionItem_subscriptionId_type_deckAppId_key" ON "SubscriptionItem"("subscriptionId", "type", "deckAppId");

-- CreateIndex
CREATE INDEX "BillingMethod_spaceId_idx" ON "BillingMethod"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCharge_orderId_key" ON "BillingCharge"("orderId");

-- CreateIndex
CREATE INDEX "BillingCharge_spaceId_createdAt_idx" ON "BillingCharge"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingCharge_status_idx" ON "BillingCharge"("status");


-- AddForeignKey
ALTER TABLE "SpaceSubscription" ADD CONSTRAINT "SpaceSubscription_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionItem" ADD CONSTRAINT "SubscriptionItem_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "SpaceSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingMethod" ADD CONSTRAINT "BillingMethod_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCharge" ADD CONSTRAINT "BillingCharge_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


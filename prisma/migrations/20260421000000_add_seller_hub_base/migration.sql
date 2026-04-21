-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('ONLINE_MARKETPLACE', 'ONLINE_MALL', 'OFFLINE', 'INTERNAL_TRANSFER', 'OTHER');

-- AlterTable
ALTER TABLE "DelOrder" ADD COLUMN     "newChannelId" TEXT;

-- AlterTable
ALTER TABLE "InvMovement" ADD COLUMN     "newChannelId" TEXT;

-- AlterTable
ALTER TABLE "InvProduct" ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "certifications" JSONB,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "features" JSONB,
ADD COLUMN     "manufactureCountry" TEXT,
ADD COLUMN     "manufactureDate" TIMESTAMP(3),
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "msrp" DECIMAL(18,2),
ADD COLUMN     "nameEn" TEXT;

-- AlterTable
ALTER TABLE "InvProductOption" ADD COLUMN     "costPrice" DECIMAL(18,2),
ADD COLUMN     "retailPrice" DECIMAL(18,2),
ADD COLUMN     "setSizeLabel" TEXT,
ADD COLUMN     "sizeLabel" TEXT;

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelGroup" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "ChannelKind" NOT NULL DEFAULT 'ONLINE_MARKETPLACE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adminUrl" TEXT,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "usesMarketingBudget" BOOLEAN NOT NULL DEFAULT false,
    "shippingFee" DECIMAL(18,2),
    "vatIncludedInFee" BOOLEAN NOT NULL DEFAULT true,
    "requireOrderNumber" BOOLEAN NOT NULL DEFAULT true,
    "requirePayment" BOOLEAN NOT NULL DEFAULT true,
    "requireProducts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelFeeRate" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "ratePercent" DECIMAL(6,3) NOT NULL,
    "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelFeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL,
    "unitCost" DECIMAL(18,2) NOT NULL,
    "quantity" INTEGER,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPricingSettings" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "defaultOperatingCostPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "defaultAdCostPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "defaultPackagingCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPricingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Brand_spaceId_idx" ON "Brand"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_spaceId_name_key" ON "Brand"("spaceId", "name");

-- CreateIndex
CREATE INDEX "ChannelGroup_spaceId_idx" ON "ChannelGroup"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelGroup_spaceId_name_key" ON "ChannelGroup"("spaceId", "name");

-- CreateIndex
CREATE INDEX "Channel_spaceId_idx" ON "Channel"("spaceId");

-- CreateIndex
CREATE INDEX "Channel_groupId_idx" ON "Channel"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_spaceId_name_key" ON "Channel"("spaceId", "name");

-- CreateIndex
CREATE INDEX "ChannelFeeRate_channelId_idx" ON "ChannelFeeRate"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelFeeRate_channelId_categoryName_key" ON "ChannelFeeRate"("channelId", "categoryName");

-- CreateIndex
CREATE INDEX "ProductionBatch_optionId_idx" ON "ProductionBatch"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_optionId_batchNo_key" ON "ProductionBatch"("optionId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPricingSettings_spaceId_key" ON "ProductPricingSettings"("spaceId");

-- CreateIndex
CREATE INDEX "InvProduct_brandId_idx" ON "InvProduct"("brandId");

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_newChannelId_fkey" FOREIGN KEY ("newChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelOrder" ADD CONSTRAINT "DelOrder_newChannelId_fkey" FOREIGN KEY ("newChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelGroup" ADD CONSTRAINT "ChannelGroup_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChannelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelFeeRate" ADD CONSTRAINT "ChannelFeeRate_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPricingSettings" ADD CONSTRAINT "ProductPricingSettings_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeckApp 시드 (upsert)
INSERT INTO "DeckApp" (id, name, "isActive") VALUES ('seller-hub', '셀러 허브', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "isActive" = true;

-- 기존 Deck deprecate
UPDATE "DeckApp" SET "isActive" = false WHERE id IN ('inventory-mgmt', 'delivery-mgmt');

-- 기존 활성 Inv/Del 사용자에게 seller-hub DeckInstance 자동 생성
INSERT INTO "DeckInstance" (id, "spaceId", "deckAppId", "isActive", "createdAt")
SELECT gen_random_uuid()::text, di."spaceId", 'seller-hub', true, NOW()
FROM "DeckInstance" di
WHERE di."deckAppId" IN ('inventory-mgmt', 'delivery-mgmt') AND di."isActive" = true
ON CONFLICT ("spaceId", "deckAppId") DO NOTHING;

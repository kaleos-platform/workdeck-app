-- CreateTable
CREATE TABLE "AdCampaignProductMap" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaignProductMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdCampaignProductMap_spaceId_idx" ON "AdCampaignProductMap"("spaceId");

-- CreateIndex
CREATE INDEX "AdCampaignProductMap_spaceId_campaignId_idx" ON "AdCampaignProductMap"("spaceId", "campaignId");

-- CreateIndex
CREATE INDEX "AdCampaignProductMap_productId_idx" ON "AdCampaignProductMap"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignProductMap_spaceId_campaignId_productId_key" ON "AdCampaignProductMap"("spaceId", "campaignId", "productId");

-- AddForeignKey
ALTER TABLE "AdCampaignProductMap" ADD CONSTRAINT "AdCampaignProductMap_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaignProductMap" ADD CONSTRAINT "AdCampaignProductMap_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

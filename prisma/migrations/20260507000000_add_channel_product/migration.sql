-- CreateTable
CREATE TABLE "ChannelProduct" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "baseSearchName" TEXT NOT NULL,
    "baseDisplayName" TEXT,
    "baseManagementName" TEXT,
    "baseInternalCode" TEXT,
    "memo" TEXT,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelProduct_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ProductListing" ADD COLUMN "channelProductId" TEXT;

-- CreateIndex
CREATE INDEX "ChannelProduct_spaceId_channelId_idx" ON "ChannelProduct"("spaceId", "channelId");

-- CreateIndex
CREATE INDEX "ChannelProduct_productId_channelId_idx" ON "ChannelProduct"("productId", "channelId");

-- CreateIndex
CREATE INDEX "ProductListing_channelProductId_idx" ON "ProductListing"("channelProductId");

-- AddForeignKey
ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_channelProductId_fkey" FOREIGN KEY ("channelProductId") REFERENCES "ChannelProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

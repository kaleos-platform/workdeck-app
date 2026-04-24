-- CreateTable
CREATE TABLE "ProductChannelGroupMeta" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductChannelGroupMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductChannelGroupMeta_productId_channelId_key" ON "ProductChannelGroupMeta"("productId", "channelId");

-- CreateIndex
CREATE INDEX "ProductChannelGroupMeta_spaceId_channelId_idx" ON "ProductChannelGroupMeta"("spaceId", "channelId");

-- AddForeignKey
ALTER TABLE "ProductChannelGroupMeta" ADD CONSTRAINT "ProductChannelGroupMeta_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChannelGroupMeta" ADD CONSTRAINT "ProductChannelGroupMeta_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChannelGroupMeta" ADD CONSTRAINT "ProductChannelGroupMeta_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

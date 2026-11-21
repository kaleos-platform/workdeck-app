-- CreateTable
CREATE TABLE "ChannelFulfillmentSetting" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "storeKey" TEXT,
    "observeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "observeCursor" JSONB,
    "observeLease" JSONB,
    "reconcileMode" TEXT NOT NULL DEFAULT 'diagnose',
    "matchKeyRule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelFulfillmentSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelOrderLine" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalLineKey" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "productName" TEXT NOT NULL,
    "optionText" TEXT,
    "quantity" INTEGER NOT NULL,
    "channelStatus" TEXT NOT NULL,
    "claimStatus" TEXT,
    "deliveryKind" TEXT NOT NULL,
    "shippingDueAt" TIMESTAMP(3),
    "carrierCode" TEXT,
    "trackingNumber" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "sourceChangedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "ChannelOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelOrderScanLine" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalLineKey" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "channelStatus" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelOrderScanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineOperation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PipelineOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelFulfillmentSetting_channelId_key" ON "ChannelFulfillmentSetting"("channelId");

-- CreateIndex
CREATE INDEX "ChannelFulfillmentSetting_spaceId_idx" ON "ChannelFulfillmentSetting"("spaceId");

-- CreateIndex
CREATE INDEX "ChannelOrderLine_spaceId_paidAt_idx" ON "ChannelOrderLine"("spaceId", "paidAt");

-- CreateIndex
CREATE INDEX "ChannelOrderLine_channelId_externalOrderId_idx" ON "ChannelOrderLine"("channelId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelOrderLine_channelId_externalLineKey_key" ON "ChannelOrderLine"("channelId", "externalLineKey");

-- CreateIndex
CREATE INDEX "ChannelOrderScanLine_operationId_idx" ON "ChannelOrderScanLine"("operationId");

-- CreateIndex
CREATE INDEX "ChannelOrderScanLine_channelId_paidAt_idx" ON "ChannelOrderScanLine"("channelId", "paidAt");

-- CreateIndex
CREATE INDEX "PipelineOperation_spaceId_kind_startedAt_idx" ON "PipelineOperation"("spaceId", "kind", "startedAt");

-- CreateIndex
CREATE INDEX "PipelineOperation_channelId_kind_startedAt_idx" ON "PipelineOperation"("channelId", "kind", "startedAt");

-- AddForeignKey
ALTER TABLE "ChannelFulfillmentSetting" ADD CONSTRAINT "ChannelFulfillmentSetting_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelOrderLine" ADD CONSTRAINT "ChannelOrderLine_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelOrderScanLine" ADD CONSTRAINT "ChannelOrderScanLine_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelOrderScanLine" ADD CONSTRAINT "ChannelOrderScanLine_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "PipelineOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineOperation" ADD CONSTRAINT "PipelineOperation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "DelBatchStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DelChannelType" AS ENUM ('OUTBOUND', 'TRANSFER');

-- CreateTable
CREATE TABLE "DelShippingMethod" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "formatConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelShippingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelChannelGroup" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelChannelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelSalesChannel" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" TEXT,
    "type" "DelChannelType" NOT NULL DEFAULT 'OUTBOUND',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requireOrderNumber" BOOLEAN NOT NULL DEFAULT true,
    "requirePayment" BOOLEAN NOT NULL DEFAULT true,
    "requireProducts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelSalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelBatch" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "status" "DelBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DelBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelOrder" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "shippingMethodId" TEXT NOT NULL,
    "channelId" TEXT,
    "recipientNameEnc" TEXT NOT NULL,
    "recipientNameIv" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "phoneIv" TEXT NOT NULL,
    "addressEnc" TEXT NOT NULL,
    "addressIv" TEXT NOT NULL,
    "postalCode" TEXT,
    "deliveryMessage" TEXT,
    "memo" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "orderNumber" TEXT,
    "paymentAmount" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DelOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelIntegrationHistory" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "totalOrders" INTEGER NOT NULL,
    "movementIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelIntegrationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DelShippingMethod_spaceId_idx" ON "DelShippingMethod"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DelShippingMethod_spaceId_name_key" ON "DelShippingMethod"("spaceId", "name");

-- CreateIndex
CREATE INDEX "DelChannelGroup_spaceId_idx" ON "DelChannelGroup"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DelChannelGroup_spaceId_name_key" ON "DelChannelGroup"("spaceId", "name");

-- CreateIndex
CREATE INDEX "DelSalesChannel_spaceId_idx" ON "DelSalesChannel"("spaceId");

-- CreateIndex
CREATE INDEX "DelSalesChannel_groupId_idx" ON "DelSalesChannel"("groupId");

-- CreateIndex
CREATE INDEX "DelBatch_spaceId_idx" ON "DelBatch"("spaceId");

-- CreateIndex
CREATE INDEX "DelBatch_spaceId_status_idx" ON "DelBatch"("spaceId", "status");

-- CreateIndex
CREATE INDEX "DelOrder_spaceId_idx" ON "DelOrder"("spaceId");

-- CreateIndex
CREATE INDEX "DelOrder_batchId_idx" ON "DelOrder"("batchId");

-- CreateIndex
CREATE INDEX "DelOrder_spaceId_orderDate_idx" ON "DelOrder"("spaceId", "orderDate");

-- CreateIndex
CREATE INDEX "DelOrderItem_orderId_idx" ON "DelOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "DelIntegrationHistory_spaceId_idx" ON "DelIntegrationHistory"("spaceId");

-- AddForeignKey
ALTER TABLE "DelShippingMethod" ADD CONSTRAINT "DelShippingMethod_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelChannelGroup" ADD CONSTRAINT "DelChannelGroup_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelSalesChannel" ADD CONSTRAINT "DelSalesChannel_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelSalesChannel" ADD CONSTRAINT "DelSalesChannel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DelChannelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelBatch" ADD CONSTRAINT "DelBatch_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelOrder" ADD CONSTRAINT "DelOrder_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelOrder" ADD CONSTRAINT "DelOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DelBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelOrder" ADD CONSTRAINT "DelOrder_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "DelShippingMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelOrder" ADD CONSTRAINT "DelOrder_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "DelSalesChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelOrderItem" ADD CONSTRAINT "DelOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DelOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelIntegrationHistory" ADD CONSTRAINT "DelIntegrationHistory_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


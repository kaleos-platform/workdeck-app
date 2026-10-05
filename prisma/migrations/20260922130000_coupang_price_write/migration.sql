-- CreateEnum
CREATE TYPE "CoupangWriteJobKind" AS ENUM ('PRICE_CHANGE', 'PRODUCT_SYNC');

-- CreateEnum
CREATE TYPE "CoupangWriteJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "CoupangProductItem" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "sellerProductId" TEXT NOT NULL,
    "itemName" TEXT,
    "rgVendorItemId" TEXT,
    "rgSalePrice" INTEGER,
    "mpVendorItemId" TEXT,
    "mpSalePrice" INTEGER,
    "barcode" TEXT,
    "skuInfo" JSONB,
    "statusName" TEXT,
    "listingId" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoupangProductItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoupangWriteJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "actionId" TEXT,
    "kind" "CoupangWriteJobKind" NOT NULL,
    "status" "CoupangWriteJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "results" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoupangWriteJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoupangProductItem_listingId_key" ON "CoupangProductItem"("listingId");

-- CreateIndex
CREATE INDEX "CoupangProductItem_spaceId_sellerProductId_idx" ON "CoupangProductItem"("spaceId", "sellerProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CoupangProductItem_spaceId_rgVendorItemId_key" ON "CoupangProductItem"("spaceId", "rgVendorItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CoupangProductItem_spaceId_mpVendorItemId_key" ON "CoupangProductItem"("spaceId", "mpVendorItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CoupangWriteJob_actionId_key" ON "CoupangWriteJob"("actionId");

-- CreateIndex
CREATE INDEX "CoupangWriteJob_status_createdAt_idx" ON "CoupangWriteJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CoupangWriteJob_workspaceId_status_idx" ON "CoupangWriteJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "CoupangWriteJob_spaceId_createdAt_idx" ON "CoupangWriteJob"("spaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "CoupangProductItem" ADD CONSTRAINT "CoupangProductItem_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoupangProductItem" ADD CONSTRAINT "CoupangProductItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoupangWriteJob" ADD CONSTRAINT "CoupangWriteJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoupangWriteJob" ADD CONSTRAINT "CoupangWriteJob_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


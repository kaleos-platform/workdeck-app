-- 채널 재고 기능 도입.
-- 1) ProductListing.channelAllocation(정적 표시 캡) → channelStock(차감형 잔량)으로 RENAME.
--    DROP+ADD가 아니라 RENAME COLUMN으로 기존 값을 초기 채널재고 잔량으로 보존한다.
-- 2) ChannelStockMovement 원장 신규 — MANUAL 배치 완료 시 차감 이력 기록(멱등키 batchId+orderItemId).

-- AlterTable: 컬럼 rename (데이터 보존)
ALTER TABLE "ProductListing" RENAME COLUMN "channelAllocation" TO "channelStock";

-- CreateTable
CREATE TABLE "ChannelStockMovement" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelStockMovement_spaceId_idx" ON "ChannelStockMovement"("spaceId");

-- CreateIndex
CREATE INDEX "ChannelStockMovement_listingId_idx" ON "ChannelStockMovement"("listingId");

-- CreateIndex
CREATE INDEX "ChannelStockMovement_batchId_idx" ON "ChannelStockMovement"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelStockMovement_batchId_orderItemId_key" ON "ChannelStockMovement"("batchId", "orderItemId");

-- AddForeignKey
ALTER TABLE "ChannelStockMovement" ADD CONSTRAINT "ChannelStockMovement_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelStockMovement" ADD CONSTRAINT "ChannelStockMovement_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelStockMovement" ADD CONSTRAINT "ChannelStockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DelBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

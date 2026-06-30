-- 연동 위치(로켓그로스) 세트 기반 발주→생산→입고 파이프라인
-- ReorderPlan.locationId + ReorderPlanSet + ProductionRunSet

-- AlterTable
ALTER TABLE "ReorderPlan" ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "ReorderPlanSet" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "listingName" TEXT NOT NULL,
    "currentSetStock" INTEGER NOT NULL,
    "suggestedSetQty" INTEGER NOT NULL,
    "finalSetQty" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReorderPlanSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRunSet" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "listingName" TEXT NOT NULL,
    "plannedSetQty" INTEGER NOT NULL,
    "stockedInSetQty" INTEGER,

    CONSTRAINT "ProductionRunSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReorderPlanSet_listingId_idx" ON "ReorderPlanSet"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderPlanSet_planId_listingId_key" ON "ReorderPlanSet"("planId", "listingId");

-- CreateIndex
CREATE INDEX "ProductionRunSet_listingId_idx" ON "ProductionRunSet"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRunSet_runId_listingId_key" ON "ProductionRunSet"("runId", "listingId");

-- CreateIndex
CREATE INDEX "ReorderPlan_spaceId_locationId_idx" ON "ReorderPlan"("spaceId", "locationId");

-- AddForeignKey
ALTER TABLE "ReorderPlan" ADD CONSTRAINT "ReorderPlan_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InvStorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlanSet" ADD CONSTRAINT "ReorderPlanSet_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ReorderPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlanSet" ADD CONSTRAINT "ReorderPlanSet_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunSet" ADD CONSTRAINT "ProductionRunSet_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunSet" ADD CONSTRAINT "ProductionRunSet_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

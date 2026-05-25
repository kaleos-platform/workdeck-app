-- 발주 예측 ReorderPlan 모델 추가
-- ReorderPlan (헤더), ReorderPlanItem (옵션별 라인), ReorderPlanAccuracy (적중률)
-- InvProduct.reorderRoundUnit 필드 추가
-- ProductionRun.reorderPlanId FK 추가

-- CreateEnum
CREATE TYPE "ReorderPlanStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "ReorderForecastModel" AS ENUM ('SMA', 'WMA', 'HW', 'CROSTON', 'BAYES', 'MANUAL');

-- AlterTable
ALTER TABLE "InvProduct" ADD COLUMN "reorderRoundUnit" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN "reorderPlanId" TEXT;

-- CreateTable
CREATE TABLE "ReorderPlan" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "planNo" TEXT NOT NULL,
    "status" "ReorderPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "windowDays" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "biasAdjustApplied" JSONB,
    "totalSuggestedQty" INTEGER NOT NULL,
    "totalFinalQty" INTEGER NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReorderPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currentStock" INTEGER NOT NULL,
    "dailyAvgForecast" DECIMAL(18,4) NOT NULL,
    "forecastModel" "ReorderForecastModel" NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "safetyStockQty" INTEGER NOT NULL,
    "suggestedQty" INTEGER NOT NULL,
    "roundedSuggestedQty" INTEGER NOT NULL,
    "finalQty" INTEGER NOT NULL,
    "roundUnit" INTEGER NOT NULL,
    "rationale" TEXT,
    "userNote" TEXT,
    "biasAdjustFactor" DECIMAL(6,4) NOT NULL,
    "confidenceScore" DECIMAL(6,4),
    "inputsSnapshot" JSONB NOT NULL,

    CONSTRAINT "ReorderPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderPlanAccuracy" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "actualOutbound" INTEGER NOT NULL,
    "forecastOutbound" DECIMAL(18,4) NOT NULL,
    "wape" DECIMAL(10,4) NOT NULL,
    "bias" DECIMAL(10,4) NOT NULL,
    "stockoutDays" INTEGER NOT NULL,
    "overstockDays" INTEGER NOT NULL,

    CONSTRAINT "ReorderPlanAccuracy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReorderPlan_spaceId_planNo_key" ON "ReorderPlan"("spaceId", "planNo");

-- CreateIndex
CREATE INDEX "ReorderPlan_spaceId_status_idx" ON "ReorderPlan"("spaceId", "status");

-- CreateIndex
CREATE INDEX "ReorderPlan_createdById_idx" ON "ReorderPlan"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderPlanItem_planId_optionId_key" ON "ReorderPlanItem"("planId", "optionId");

-- CreateIndex
CREATE INDEX "ReorderPlanItem_planId_idx" ON "ReorderPlanItem"("planId");

-- CreateIndex
CREATE INDEX "ReorderPlanItem_optionId_idx" ON "ReorderPlanItem"("optionId");

-- CreateIndex
CREATE INDEX "ReorderPlanAccuracy_planId_idx" ON "ReorderPlanAccuracy"("planId");

-- CreateIndex
CREATE INDEX "ReorderPlanAccuracy_optionId_idx" ON "ReorderPlanAccuracy"("optionId");

-- CreateIndex
CREATE INDEX "ReorderPlanAccuracy_planId_optionId_idx" ON "ReorderPlanAccuracy"("planId", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRun_reorderPlanId_key" ON "ProductionRun"("reorderPlanId");

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_reorderPlanId_fkey" FOREIGN KEY ("reorderPlanId") REFERENCES "ReorderPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlan" ADD CONSTRAINT "ReorderPlan_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlan" ADD CONSTRAINT "ReorderPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlanItem" ADD CONSTRAINT "ReorderPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ReorderPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlanItem" ADD CONSTRAINT "ReorderPlanItem_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlanItem" ADD CONSTRAINT "ReorderPlanItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlanAccuracy" ADD CONSTRAINT "ReorderPlanAccuracy_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ReorderPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderPlanAccuracy" ADD CONSTRAINT "ReorderPlanAccuracy_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

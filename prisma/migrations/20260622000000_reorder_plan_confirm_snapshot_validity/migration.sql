-- 발주 계획 재설계 Phase 1 — additive 스키마 (비파괴)
-- "예측 검증 시작"(확정) 시점 동결 스냅샷 + revision 계보 + accuracy 유효성/평가상태.
-- 모두 nullable/기본값. 기존 데이터 영향 없음.
-- (hand-write: shadow DB storage.buckets P3006 우회 — migrate deploy로 적용)

-- CreateEnum
CREATE TYPE "ReorderSnapshotSource" AS ENUM ('LIVE', 'BACKFILLED');

-- CreateEnum
CREATE TYPE "ReorderAccuracyValidity" AS ENUM ('ACTIVE', 'INVALIDATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ReorderEvaluationStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'MEASURED', 'INVALIDATED');

-- AlterTable
ALTER TABLE "ReorderPlan" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "sourcePlanId" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededByPlanId" TEXT;

-- AlterTable
ALTER TABLE "ReorderPlanItem" ADD COLUMN     "confirmedDailyAvgForecast" DECIMAL(18,4),
ADD COLUMN     "confirmedFinalQty" INTEGER,
ADD COLUMN     "confirmedLeadTimeDays" INTEGER,
ADD COLUMN     "confirmedSafetyStockQty" INTEGER,
ADD COLUMN     "snapshotSource" "ReorderSnapshotSource";

-- AlterTable
ALTER TABLE "ReorderPlanAccuracy" ADD COLUMN     "biasSourcePlanId" TEXT,
ADD COLUMN     "evaluationStatus" "ReorderEvaluationStatus" NOT NULL DEFAULT 'MEASURED',
ADD COLUMN     "validity" "ReorderAccuracyValidity" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "ReorderPlan_spaceId_confirmedAt_idx" ON "ReorderPlan"("spaceId", "confirmedAt");

-- CreateIndex
CREATE INDEX "ReorderPlan_sourcePlanId_idx" ON "ReorderPlan"("sourcePlanId");

-- CreateIndex
CREATE INDEX "ReorderPlanAccuracy_validity_idx" ON "ReorderPlanAccuracy"("validity");

-- AddForeignKey
ALTER TABLE "ReorderPlan" ADD CONSTRAINT "ReorderPlan_sourcePlanId_fkey" FOREIGN KEY ("sourcePlanId") REFERENCES "ReorderPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: 기존 FINALIZED/CONSUMED 계획의 confirmedAt = finalizedAt (없으면 createdAt)
UPDATE "ReorderPlan"
SET "confirmedAt" = COALESCE("finalizedAt", "createdAt")
WHERE "status" IN ('FINALIZED', 'CONSUMED') AND "confirmedAt" IS NULL;

-- Backfill: 기존 확정 계획 item의 동결 스냅샷 = 현재 값 (BACKFILLED 표시 — 진짜 확정 당시 값 아님)
UPDATE "ReorderPlanItem" AS i
SET "confirmedDailyAvgForecast" = i."dailyAvgForecast",
    "confirmedLeadTimeDays"     = i."leadTimeDays",
    "confirmedSafetyStockQty"   = i."safetyStockQty",
    "confirmedFinalQty"         = i."finalQty",
    "snapshotSource"            = 'BACKFILLED'
FROM "ReorderPlan" AS p
WHERE i."planId" = p."id"
  AND p."status" IN ('FINALIZED', 'CONSUMED')
  AND i."snapshotSource" IS NULL;

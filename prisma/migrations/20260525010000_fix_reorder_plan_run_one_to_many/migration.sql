-- ReorderPlan → ProductionRun 관계를 1:1 → 1:N으로 변경
-- UNIQUE 제약 제거 후 일반 인덱스 추가

-- DropIndex
DROP INDEX "ProductionRun_reorderPlanId_key";

-- CreateIndex
CREATE INDEX "ProductionRun_reorderPlanId_idx" ON "ProductionRun"("reorderPlanId");

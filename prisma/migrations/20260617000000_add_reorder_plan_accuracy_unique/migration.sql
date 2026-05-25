-- 발주 계획 적중률 복합 유니크 제약 추가
-- ReorderPlanAccuracy: (planId, optionId) 쌍 중복 방지

-- 기존 복합 index 제거 (unique index로 대체됨)
DROP INDEX IF EXISTS "ReorderPlanAccuracy_planId_optionId_idx";

-- unique 제약 생성
CREATE UNIQUE INDEX "ReorderPlanAccuracy_planId_optionId_key" ON "ReorderPlanAccuracy"("planId", "optionId");

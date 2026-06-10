-- 실제 입고 수량 기록 컬럼 추가 (null = 입고완료 전, 0 이상 = 실입고)
ALTER TABLE "ProductionRunItem" ADD COLUMN "stockedInQty" INTEGER;

-- backfill: 기존 입고완료(STOCKED_IN) 차수는 1차 코드가 분배 합 = 발주 수량을 강제했으므로
-- 실입고 = 발주 수량이 입증됨. 이후 stockedInQty IS NULL = "아직 입고완료 안 됨" 단일 의미.
UPDATE "ProductionRunItem" i
SET "stockedInQty" = i."quantity"
FROM "ProductionRun" r
WHERE i."runId" = r."id" AND r."status" = 'STOCKED_IN';

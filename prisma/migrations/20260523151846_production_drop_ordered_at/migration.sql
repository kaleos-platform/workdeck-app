-- ProductionRun.orderedAt 컬럼 제거
-- orderedConfirmedAt 이 발주일의 단일 출처로 통일됨.

-- 1) orderedConfirmedAt 백필 — 기존에 null 이면 orderedAt 값을 사용
UPDATE "ProductionRun"
SET "orderedConfirmedAt" = "orderedAt"
WHERE "orderedConfirmedAt" IS NULL;

-- 2) 인덱스 정리
DROP INDEX IF EXISTS "ProductionRun_spaceId_orderedAt_idx";
CREATE INDEX "ProductionRun_spaceId_orderedConfirmedAt_idx"
  ON "ProductionRun"("spaceId", "orderedConfirmedAt");

-- 3) 컬럼 제거
ALTER TABLE "ProductionRun" DROP COLUMN "orderedAt";

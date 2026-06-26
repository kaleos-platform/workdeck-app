-- 방향별 분류 규칙: 동일 적요라도 비용(OUT)/수입(IN)을 별개 규칙으로 구분.

-- AlterTable: 방향 컬럼 추가(nullable, null = 방향 무관)
ALTER TABLE "FinClassRule" ADD COLUMN "direction" "FinTxnDirection";

-- 기존 규칙 backfill: 대상 계정과목 type → 방향 (INCOME=IN, EXPENSE=OUT, 그 외 NULL).
-- null로 두면 레거시 수입 규칙이 지출에도 매칭해 방향 구분이 무력화되므로 반드시 backfill.
UPDATE "FinClassRule" r
SET "direction" = CASE c."type"
  WHEN 'INCOME' THEN 'IN'::"FinTxnDirection"
  WHEN 'EXPENSE' THEN 'OUT'::"FinTxnDirection"
  ELSE NULL
END
FROM "FinCategory" c
WHERE r."categoryId" = c."id";

-- 유니크 재구성: (spaceId, matchKey) → (spaceId, matchKey, direction)
DROP INDEX "FinClassRule_spaceId_matchKey_key";
CREATE UNIQUE INDEX "FinClassRule_spaceId_matchKey_direction_key" ON "FinClassRule"("spaceId", "matchKey", "direction");

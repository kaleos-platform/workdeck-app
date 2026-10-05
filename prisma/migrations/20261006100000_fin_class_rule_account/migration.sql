-- AlterTable
ALTER TABLE "FinClassRule" ADD COLUMN "accountId" TEXT;

-- 기존 규칙 계좌 백필: 이 규칙으로 분류된(계정과목이 그대로인) 확정 거래가 전부 한 계좌면 그 계좌로.
-- 여러 계좌·이력 없음은 NULL(전체 공통) 유지. 운영 시뮬레이션(2026-10-05): 674 중 557 배정, 다계좌 16, 이력 없음 101.
UPDATE "FinClassRule" r SET "accountId" = s.acc
FROM (
  SELECT t."matchedRuleId" AS rid, MIN(t."accountId") AS acc
  FROM "FinTransaction" t
  JOIN "FinClassRule" r2 ON r2.id = t."matchedRuleId"
  WHERE t."categoryId" = r2."categoryId"
  GROUP BY t."matchedRuleId"
  HAVING COUNT(DISTINCT t."accountId") = 1
) s
WHERE r.id = s.rid;

-- 유일키 교체
DROP INDEX "FinClassRule_spaceId_matchKey_direction_key";
CREATE UNIQUE INDEX "FinClassRule_spaceId_accountId_matchKey_direction_key" ON "FinClassRule"("spaceId", "accountId", "matchKey", "direction");
CREATE INDEX "FinClassRule_spaceId_accountId_idx" ON "FinClassRule"("spaceId", "accountId");

-- AddForeignKey
ALTER TABLE "FinClassRule" ADD CONSTRAINT "FinClassRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

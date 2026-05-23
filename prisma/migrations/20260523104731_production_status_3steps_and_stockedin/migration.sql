-- ProductionRunStatus 3단계 단순화 + 상태 전환 타임스탬프/위치 추가
-- PLANNED, ORDERED 유지 / PRODUCING 제거 / COMPLETED → STOCKED_IN

-- 1) 새 enum 타입 생성
CREATE TYPE "ProductionRunStatus_new" AS ENUM ('PLANNED', 'ORDERED', 'STOCKED_IN');

-- 2) 추가 컬럼
ALTER TABLE "ProductionRun"
  ADD COLUMN "orderedConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "stockedInAt"        TIMESTAMP(3),
  ADD COLUMN "stockInLocationId"  TEXT;

-- 3) 기존 status 컬럼을 text 로 캐스팅 후, default 제거 (enum 교체 준비)
ALTER TABLE "ProductionRun" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ProductionRun"
  ALTER COLUMN "status" TYPE TEXT USING "status"::text;

-- 4) 데이터 이관: PRODUCING / COMPLETED → STOCKED_IN
UPDATE "ProductionRun"
SET "status"      = 'STOCKED_IN',
    "stockedInAt" = COALESCE("completedAt", "updatedAt")
WHERE "status" IN ('PRODUCING', 'COMPLETED');

-- 5) 새 enum 으로 컬럼 타입 변경
ALTER TABLE "ProductionRun"
  ALTER COLUMN "status" TYPE "ProductionRunStatus_new" USING "status"::"ProductionRunStatus_new";

-- 6) 구 enum 제거 + 신 enum 이름 정리
DROP TYPE "ProductionRunStatus";
ALTER TYPE "ProductionRunStatus_new" RENAME TO "ProductionRunStatus";

-- 7) default 복원
ALTER TABLE "ProductionRun"
  ALTER COLUMN "status" SET DEFAULT 'PLANNED';

-- 8) FK: stockInLocationId -> InvStorageLocation.id (SetNull)
ALTER TABLE "ProductionRun"
  ADD CONSTRAINT "ProductionRun_stockInLocationId_fkey"
  FOREIGN KEY ("stockInLocationId") REFERENCES "InvStorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

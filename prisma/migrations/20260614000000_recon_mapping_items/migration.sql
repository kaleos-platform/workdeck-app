-- 재고 대조 외부코드 매핑 1:N 확장
-- InvLocationProductMap.optionId 제거 → InvLocationProductMapItem 자식 테이블로 분리
-- 순서: 신규 테이블 생성 → 데이터 이관 → 기존 FK/컬럼 제거

-- 1. 신규 테이블 생성
CREATE TABLE "InvLocationProductMapItem" (
  "id"       TEXT NOT NULL,
  "mapId"    TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "InvLocationProductMapItem_pkey" PRIMARY KEY ("id")
);

-- 2. unique + index
CREATE UNIQUE INDEX "InvLocationProductMapItem_mapId_optionId_key"
  ON "InvLocationProductMapItem"("mapId", "optionId");
CREATE INDEX "InvLocationProductMapItem_optionId_idx"
  ON "InvLocationProductMapItem"("optionId");

-- 3. 기존 매핑 데이터 이관 (optionId가 있는 행만)
INSERT INTO "InvLocationProductMapItem" ("id", "mapId", "optionId", "quantity")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 24),
  "id",
  "optionId",
  1
FROM "InvLocationProductMap"
WHERE "optionId" IS NOT NULL;

-- 4. FK 추가
ALTER TABLE "InvLocationProductMapItem"
  ADD CONSTRAINT "InvLocationProductMapItem_mapId_fkey"
  FOREIGN KEY ("mapId") REFERENCES "InvLocationProductMap"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvLocationProductMapItem"
  ADD CONSTRAINT "InvLocationProductMapItem_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. 기존 optionId FK 제거
ALTER TABLE "InvLocationProductMap"
  DROP CONSTRAINT IF EXISTS "InvLocationProductMap_optionId_fkey";

-- 6. optionId 인덱스 제거
DROP INDEX IF EXISTS "InvLocationProductMap_optionId_idx";

-- 7. optionId 컬럼 제거 (데이터 이관 완료 후)
ALTER TABLE "InvLocationProductMap" DROP COLUMN "optionId";

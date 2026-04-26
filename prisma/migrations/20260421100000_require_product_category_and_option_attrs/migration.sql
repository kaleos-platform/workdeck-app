-- Migration: require_product_category_and_option_attrs
-- 1) 각 Space에 "기본" 카테고리 upsert (없으면 생성)
INSERT INTO "InvProductGroup" (id, "spaceId", name, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.id, '기본', NOW(), NOW()
FROM "Space" s
WHERE NOT EXISTS (
  SELECT 1 FROM "InvProductGroup" g
  WHERE g."spaceId" = s.id AND g.name = '기본'
);

-- 2) NULL groupId 상품을 해당 Space의 "기본" 카테고리로 업데이트
UPDATE "InvProduct" p
SET "groupId" = (
  SELECT g.id FROM "InvProductGroup" g
  WHERE g."spaceId" = p."spaceId" AND g.name = '기본'
  LIMIT 1
)
WHERE p."groupId" IS NULL;

-- 3) groupId NOT NULL 제약 적용
ALTER TABLE "InvProduct" ALTER COLUMN "groupId" SET NOT NULL;

-- 4) InvProduct에 optionAttributes(JSONB) 컬럼 추가
ALTER TABLE "InvProduct" ADD COLUMN "optionAttributes" JSONB;

-- 5) InvProductOption에 attributeValues(JSONB) 컬럼 추가
ALTER TABLE "InvProductOption" ADD COLUMN "attributeValues" JSONB;

-- 6) InvProduct.group relation onDelete: Restrict — FK 제약 재설정
-- (기존 FK는 ON DELETE SET NULL 이었음)
ALTER TABLE "InvProduct" DROP CONSTRAINT IF EXISTS "InvProduct_groupId_fkey";
ALTER TABLE "InvProduct"
  ADD CONSTRAINT "InvProduct_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

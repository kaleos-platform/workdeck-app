-- AlterTable
ALTER TABLE "FinCategory" ADD COLUMN     "isContra" BOOLEAN NOT NULL DEFAULT false;

-- 기존 finance 공간 백필: 차감 계정 2종을 운영 차트 대분류 아래 생성(신규 공간은 kifrs-seed가 생성).
-- 대분류(수입>매출 / 지출>상품원가)를 사용자가 지우거나 이름을 바꾼 공간은 건너뛴다. 이미 있으면 무시.
INSERT INTO "FinCategory" ("id", "spaceId", "parentId", "name", "code", "type", "isContra", "isSystem", "isActive", "sortOrder", "updatedAt")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text || g."id"), 1, 24),
  g."spaceId",
  g."id",
  v.name,
  v.code,
  g."type",
  true,
  false,
  true,
  COALESCE((SELECT MAX(s."sortOrder") + 1 FROM "FinCategory" s WHERE s."parentId" = g."id"), 0),
  NOW()
FROM "FinCategory" g
JOIN "FinCategory" r ON r."id" = g."parentId" AND r."parentId" IS NULL
JOIN (VALUES
  ('INCOME'::"FinCategoryType", '매출', '매출환입(반품·환불)', '4100'),
  ('EXPENSE'::"FinCategoryType", '상품원가', '매입환출(구매 환불)', '5100')
) AS v(type, parent_name, name, code) ON v.type = g."type" AND v.parent_name = g."name"
ON CONFLICT ("spaceId", "parentId", "name") DO NOTHING;

-- 기존 space의 level-1 대분류에 손익 흐름도 역할 백필(이름 기반, 멱등).
-- 핵심 3역할만 명시 태깅 — 미태그 수입=기타수익, 미태그 지출=판매관리비(OPEX)로 흐름도가 처리.
-- level-1 대분류 = 부모가 루트(parentId IS NULL)인 카테고리.

UPDATE "FinCategory" c
SET "flowRole" = 'MERCH_SALES'
WHERE c."flowRole" IS NULL AND c."name" = '매출'
  AND c."parentId" IN (SELECT id FROM "FinCategory" WHERE "parentId" IS NULL AND "type" = 'INCOME');

UPDATE "FinCategory" c
SET "flowRole" = 'COGS'
WHERE c."flowRole" IS NULL AND c."name" = '상품원가'
  AND c."parentId" IN (SELECT id FROM "FinCategory" WHERE "parentId" IS NULL AND "type" = 'EXPENSE');

UPDATE "FinCategory" c
SET "flowRole" = 'FINANCING_COST'
WHERE c."flowRole" IS NULL AND c."name" = '금융비용'
  AND c."parentId" IN (SELECT id FROM "FinCategory" WHERE "parentId" IS NULL AND "type" = 'EXPENSE');

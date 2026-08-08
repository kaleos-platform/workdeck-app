-- 소비자가를 옵션 단위로 일원화한다.
-- 상품(InvProduct.msrp)에 있던 소비자가를 아직 값이 없는 활성 옵션으로 복사한다.
--
-- msrp 컬럼 자체는 지우지 않는다 — 판매채널 상품 구성/옵션 선택 등 서버측
-- `option.retailPrice ?? product.msrp` 폴백을 안전망으로 유지하기 때문.
-- 소프트삭제된 옵션(deletedAt IS NOT NULL)은 히스토리 보존용이라 제외한다.
-- IS NULL 조건 덕분에 재실행해도 no-op(멱등).

UPDATE "InvProductOption" o
SET "retailPrice" = p."msrp"
FROM "InvProduct" p
WHERE o."productId" = p."id"
  AND o."retailPrice" IS NULL
  AND o."deletedAt" IS NULL
  AND p."msrp" IS NOT NULL;

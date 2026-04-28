-- Idempotent seed for sales-content DeckApp row.
--
-- 컨텍스트: prisma/seed.ts 는 로컬 dev 전용. prisma migrate deploy 는 스키마만 적용하고
-- seed 를 실행하지 않으므로, 운영(prod) DeckApp 테이블에 sales-content row 가 들어가지
-- 않는다. PR #19 (sales-content Phase 1 release) 후 운영 /my-deck 에 카드가 보이지
-- 않은 원인이 이 누락이었음 (롤백 사유).
--
-- 정책: 정적 시드는 data-only 마이그레이션으로 분리한다 (선례:
-- 20260510000000_rename_seller_hub_deck 의 UPDATE).
--
-- 영향 범위: DeckApp 테이블의 'sales-content' 단 1행. 다른 row (coupang-ads,
-- seller-hub, delivery-mgmt, inventory-mgmt 등) 는 건드리지 않는다.
--
-- 멱등성: ON CONFLICT (id) DO UPDATE 로 재실행 안전.

INSERT INTO "DeckApp" (id, name, "isActive")
VALUES ('sales-content', '세일즈 콘텐츠', true)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      "isActive" = EXCLUDED."isActive";

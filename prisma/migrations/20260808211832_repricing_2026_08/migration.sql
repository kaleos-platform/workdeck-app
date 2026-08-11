-- 가격 개정 (2026-08). 값은 공급가(VAT 별도) — 표시가는 ×1.1.
-- 순위: 브랜드 운영 > 재무 관리 > 쿠팡 광고 관리 > 세일즈 콘텐츠 = 모집 관리.
-- 전 deck FREE_BETA이고 SubscriptionItem 0건이라 기존 구독 스냅샷에 영향 없음.
-- seed는 prod에서 돌지 않으므로 여기서 직접 갱신한다 (단일 출처: catalog-defaults.ts).

UPDATE "BillingDeckProduct" SET "monthlyPrice" = 50000 WHERE id = 'seller-hub';
UPDATE "BillingDeckProduct" SET "monthlyPrice" = 40000 WHERE id = 'finance';
UPDATE "BillingDeckProduct" SET "monthlyPrice" = 30000 WHERE id = 'coupang-ads';
UPDATE "BillingDeckProduct" SET "monthlyPrice" = 20000 WHERE id = 'sales-content';
UPDATE "BillingDeckProduct" SET "monthlyPrice" = 20000 WHERE id = 'recruiting';

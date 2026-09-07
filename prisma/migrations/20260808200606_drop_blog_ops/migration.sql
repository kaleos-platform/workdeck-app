-- 블로그 운영(blog-ops) deck 폐기 (2026-08)
-- prod 사전 감사: Bo* 테이블 전부 0행, DeckApp/DeckInstance/SubscriptionItem/BillingCharge 관련 행 0.
-- 남은 것은 BillingDeckProduct 1행(FREE_BETA)뿐이라 아래에서 정리한다.

BEGIN;

-- 1) 카탈로그·인스턴스 정리 (DeckApp 행은 FK 보존 목적상 삭제하지 않고 비활성 — inventory-mgmt 선례)
UPDATE "DeckApp" SET "isActive" = false WHERE id = 'blog-ops';
UPDATE "DeckInstance" SET "isActive" = false WHERE "deckAppId" = 'blog-ops';
DELETE FROM "BillingDeckProduct" WHERE id = 'blog-ops';
DELETE FROM "SubscriptionItem" WHERE "deckAppId" = 'blog-ops';

-- 2) 테이블 drop (의존 순서 무관하도록 CASCADE)
DROP TABLE IF EXISTS "BoChannelCredential" CASCADE;
DROP TABLE IF EXISTS "BoJob" CASCADE;
DROP TABLE IF EXISTS "BoDeployment" CASCADE;
DROP TABLE IF EXISTS "BoPostVariant" CASCADE;
DROP TABLE IF EXISTS "BoPostVersion" CASCADE;
DROP TABLE IF EXISTS "BoPost" CASCADE;
DROP TABLE IF EXISTS "BoChannel" CASCADE;
DROP TABLE IF EXISTS "BoMaterial" CASCADE;
DROP TABLE IF EXISTS "BoIdeation" CASCADE;
DROP TABLE IF EXISTS "BoProduct" CASCADE;

-- 3) enum drop
DROP TYPE IF EXISTS "BoCredentialKind";
DROP TYPE IF EXISTS "BoJobStatus";
DROP TYPE IF EXISTS "BoJobKind";
DROP TYPE IF EXISTS "BoDeploymentStatus";
DROP TYPE IF EXISTS "BoVariantStatus";
DROP TYPE IF EXISTS "BoPublisherMode";
DROP TYPE IF EXISTS "BoPlatform";
DROP TYPE IF EXISTS "BoPostStatus";
DROP TYPE IF EXISTS "BoMaterialStatus";
DROP TYPE IF EXISTS "BoCrawlStatus";

COMMIT;

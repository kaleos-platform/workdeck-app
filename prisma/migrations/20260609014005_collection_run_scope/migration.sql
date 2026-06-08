-- CollectionRun 수동 수집 작업 스코프 필드
-- 자동(scheduled)·기존 행은 default true(전체 수집) — 회귀 없음.
ALTER TABLE "CollectionRun" ADD COLUMN IF NOT EXISTS "collectAds" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CollectionRun" ADD COLUMN IF NOT EXISTS "collectInventory" BOOLEAN NOT NULL DEFAULT true;

-- CoupangBackfillJob: 수집 트리거 구분 (backfill UI / scheduled cron)
ALTER TABLE "CoupangBackfillJob" ADD COLUMN IF NOT EXISTS "trigger" TEXT NOT NULL DEFAULT 'backfill';

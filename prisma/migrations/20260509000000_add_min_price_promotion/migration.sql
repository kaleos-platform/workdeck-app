-- Add MIN_PRICE value to PromotionType enum
-- ALTER TYPE ADD VALUE cannot run inside a transaction block (Postgres 제약).
-- Supabase 16+에서는 단독 실행으로 정상 동작한다.
ALTER TYPE "PromotionType" ADD VALUE IF NOT EXISTS 'MIN_PRICE';

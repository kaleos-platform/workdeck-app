-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

-- 이미 인증 앱을 등록(verified)한 계정은 필수로 시작한다 — 배포 직후 기존 보호 대상에 공백이 없게.
-- shadow DB 에는 auth 스키마가 없으므로 가드한다.
DO $$
BEGIN
  IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
    UPDATE "User" SET "mfaRequired" = true
    WHERE "id" IN (SELECT user_id::text FROM auth.mfa_factors WHERE status = 'verified');
  END IF;
END $$;

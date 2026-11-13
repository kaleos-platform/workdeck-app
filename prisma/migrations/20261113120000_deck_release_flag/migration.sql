-- 업무 공개(released) 플래그. 기본 false=「준비중」 — 새 업무는 준비중으로 시작해 어드민에서 공개한다.
-- AlterTable
ALTER TABLE "BillingDeckProduct" ADD COLUMN     "released" BOOLEAN NOT NULL DEFAULT false;

-- 출시 시점(2026-11-13) 공개 업무는 모집 관리(recruiting)만.
UPDATE "BillingDeckProduct" SET "released" = true WHERE "id" = 'recruiting';

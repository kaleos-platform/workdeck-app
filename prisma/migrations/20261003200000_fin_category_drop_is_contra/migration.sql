-- 차감 계정(isContra) 개념 폐기 — 환불은 원래 계정에서 차감(contra.ts). 코드 사용은 #998에서 먼저 제거(expand/contract).
-- AlterTable
ALTER TABLE "FinCategory" DROP COLUMN "isContra";

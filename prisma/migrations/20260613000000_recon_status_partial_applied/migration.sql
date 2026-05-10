-- AlterEnum: InvReconciliationStatus에 PARTIAL, APPLIED 값 추가
ALTER TYPE "InvReconciliationStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
ALTER TYPE "InvReconciliationStatus" ADD VALUE IF NOT EXISTS 'APPLIED';

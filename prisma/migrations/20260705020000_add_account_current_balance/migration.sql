-- 기준(현재) 잔액 + 기준일 (표시용, 대시보드 잔액 계산 무관)
ALTER TABLE "FinAccount" ADD COLUMN "currentBalance" DECIMAL(18,2);
ALTER TABLE "FinAccount" ADD COLUMN "currentBalanceAsOf" TIMESTAMP(3);

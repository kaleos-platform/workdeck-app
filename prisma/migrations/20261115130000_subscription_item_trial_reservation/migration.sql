-- 체험 중 구독 예약: 결제 전 아이템 표시 + 체험 종료일 일할 결제 재시도 횟수
ALTER TABLE "SubscriptionItem" ADD COLUMN     "awaitingTrialEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billingRetryCount" INTEGER NOT NULL DEFAULT 0;

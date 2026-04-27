-- 온보딩 카드 닫힘 시각: 사용자가 X 버튼으로 명시적 skip 했을 때만 set
ALTER TABLE "Space" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);

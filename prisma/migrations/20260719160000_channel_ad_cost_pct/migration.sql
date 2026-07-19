-- 채널별 광고비율 (0~1, null=미설정 → 시뮬 앱 기본값 폴백)
ALTER TABLE "Channel" ADD COLUMN "adCostPct" DECIMAL(6,4);

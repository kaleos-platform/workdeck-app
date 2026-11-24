-- 도입 신청 안내 메일의 발송 시각과 운영자를 기록한다.
ALTER TABLE "MarketingLead" ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "invitedBy" TEXT;

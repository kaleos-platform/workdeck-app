-- AlterTable
ALTER TABLE "SpaceInvitation" ADD COLUMN     "lastSendFailed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "sendCount" INTEGER NOT NULL DEFAULT 1;

-- 기존 행: 생성 시각을 최초 발송 시각으로 본다
UPDATE "SpaceInvitation" SET "lastSentAt" = "createdAt" WHERE "lastSentAt" IS NULL;

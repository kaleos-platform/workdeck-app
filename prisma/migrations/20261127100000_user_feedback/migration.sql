-- CreateEnum
CREATE TYPE "UserFeedbackType" AS ENUM ('FEATURE', 'BUG', 'QUESTION', 'REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "UserFeedbackStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'ON_HOLD');

-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT,
    "type" "UserFeedbackType" NOT NULL,
    "body" TEXT NOT NULL,
    "pagePath" TEXT,
    "userAgent" TEXT,
    "status" "UserFeedbackStatus" NOT NULL DEFAULT 'NEW',
    "memo" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFeedbackAttachment" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeedbackAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackFileDeletion" (
    "id" TEXT NOT NULL,
    "paths" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackFileDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserFeedback_createdAt_idx" ON "UserFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "UserFeedback_status_closedAt_idx" ON "UserFeedback"("status", "closedAt");

-- CreateIndex
CREATE INDEX "UserFeedback_userId_idx" ON "UserFeedback"("userId");

-- CreateIndex
CREATE INDEX "UserFeedback_spaceId_idx" ON "UserFeedback"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFeedbackAttachment_path_key" ON "UserFeedbackAttachment"("path");

-- CreateIndex
CREATE INDEX "UserFeedbackAttachment_feedbackId_idx" ON "UserFeedbackAttachment"("feedbackId");

-- CreateIndex
CREATE INDEX "FeedbackFileDeletion_createdAt_idx" ON "FeedbackFileDeletion"("createdAt");

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeedbackAttachment" ADD CONSTRAINT "UserFeedbackAttachment_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "UserFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS: 앱은 service role(Prisma)로만 접근한다. anon/authenticated 정책 없음 = 차단.
ALTER TABLE "UserFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserFeedbackAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeedbackFileDeletion" ENABLE ROW LEVEL SECURITY;

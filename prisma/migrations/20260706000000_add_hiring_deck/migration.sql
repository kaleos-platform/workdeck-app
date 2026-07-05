-- CreateEnum
CREATE TYPE "HiringPostingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HiringJobType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCER', 'INTERN');

-- CreateEnum
CREATE TYPE "HiringPayFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'PER_TASK', 'TBD');

-- CreateEnum
CREATE TYPE "HiringApplicationStage" AS ENUM ('HIRING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HiringProcessStage" AS ENUM ('APPLIED', 'INTERVIEW', 'JOB_OFFER');

-- CreateEnum
CREATE TYPE "HiringContentSourceType" AS ENUM ('POSTING_DETAIL', 'DETAIL_TEMPLATE');

-- CreateEnum
CREATE TYPE "HiringNotificationType" AS ENUM ('INTERVIEW', 'JOB_OFFER', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "HiringStore" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roadAddress" TEXT,
    "detailAddress" TEXT,
    "zipcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPosition" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPosting" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "HiringPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "detail" JSONB,
    "applicationEntries" JSONB,
    "managerNameEnc" TEXT,
    "managerNameIv" TEXT,
    "managerPhoneEnc" TEXT,
    "managerPhoneIv" TEXT,
    "closingDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPostingPosition" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "positionId" TEXT,
    "name" TEXT NOT NULL,
    "jobType" "HiringJobType",
    "payFrequency" "HiringPayFrequency",
    "payAmount" INTEGER,
    "workDays" JSONB,
    "workStartAt" TEXT,
    "workEndAt" TEXT,
    "headcount" INTEGER,
    "experience" TEXT,
    "education" TEXT,
    "jobDescription" TEXT,
    "requiredQualifications" TEXT,
    "preferredQualifications" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringPostingPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPostingStore" (
    "id" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "HiringPostingStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringPostingManager" (
    "id" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "HiringPostingManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringContent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "sourceType" "HiringContentSourceType" NOT NULL,
    "postingId" TEXT,
    "templateId" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'excalidraw',
    "data" JSONB,
    "imagePath" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringDetailTemplate" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB,
    "imagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringDetailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringApplication" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "postingPositionId" TEXT,
    "uuid" TEXT NOT NULL,
    "applicationEntries" JSONB,
    "nameEnc" TEXT,
    "nameIv" TEXT,
    "nameHash" TEXT,
    "maskedName" TEXT,
    "phoneEnc" TEXT,
    "phoneIv" TEXT,
    "phoneHash" TEXT,
    "phoneLastDigitsHash" TEXT,
    "emailEnc" TEXT,
    "emailIv" TEXT,
    "emailHash" TEXT,
    "addressEnc" TEXT,
    "addressIv" TEXT,
    "stage" "HiringApplicationStage" NOT NULL DEFAULT 'HIRING',
    "hiringStage" "HiringProcessStage" NOT NULL DEFAULT 'APPLIED',
    "referrer" TEXT,
    "directRegistration" BOOLEAN NOT NULL DEFAULT false,
    "duplicated" BOOLEAN NOT NULL DEFAULT false,
    "memo" TEXT,
    "privacyAgreedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringApplicationStore" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "HiringApplicationStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringApplicationFile" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringApplicationFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringComment" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringApplicationNotification" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "notiType" "HiringNotificationType" NOT NULL,
    "detailMessage" TEXT,
    "uuid" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenExpireAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringApplicationNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringBlacklist" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "phoneIv" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "reason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringBlacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringMessageTemplate" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringStore_spaceId_idx" ON "HiringStore"("spaceId");

-- CreateIndex
CREATE INDEX "HiringPosition_spaceId_idx" ON "HiringPosition"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPosting_uuid_key" ON "HiringPosting"("uuid");

-- CreateIndex
CREATE INDEX "HiringPosting_spaceId_status_idx" ON "HiringPosting"("spaceId", "status");

-- CreateIndex
CREATE INDEX "HiringPosting_spaceId_createdAt_idx" ON "HiringPosting"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "HiringPostingPosition_postingId_idx" ON "HiringPostingPosition"("postingId");

-- CreateIndex
CREATE INDEX "HiringPostingPosition_spaceId_idx" ON "HiringPostingPosition"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPostingStore_postingId_storeId_key" ON "HiringPostingStore"("postingId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringPostingManager_postingId_userId_key" ON "HiringPostingManager"("postingId", "userId");

-- CreateIndex
CREATE INDEX "HiringContent_postingId_idx" ON "HiringContent"("postingId");

-- CreateIndex
CREATE INDEX "HiringContent_templateId_idx" ON "HiringContent"("templateId");

-- CreateIndex
CREATE INDEX "HiringContent_spaceId_idx" ON "HiringContent"("spaceId");

-- CreateIndex
CREATE INDEX "HiringDetailTemplate_spaceId_idx" ON "HiringDetailTemplate"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringApplication_uuid_key" ON "HiringApplication"("uuid");

-- CreateIndex
CREATE INDEX "HiringApplication_spaceId_stage_idx" ON "HiringApplication"("spaceId", "stage");

-- CreateIndex
CREATE INDEX "HiringApplication_spaceId_createdAt_idx" ON "HiringApplication"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "HiringApplication_postingId_idx" ON "HiringApplication"("postingId");

-- CreateIndex
CREATE INDEX "HiringApplication_spaceId_phoneHash_idx" ON "HiringApplication"("spaceId", "phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "HiringApplicationStore_applicationId_storeId_key" ON "HiringApplicationStore"("applicationId", "storeId");

-- CreateIndex
CREATE INDEX "HiringApplicationFile_applicationId_idx" ON "HiringApplicationFile"("applicationId");

-- CreateIndex
CREATE INDEX "HiringApplicationFile_spaceId_idx" ON "HiringApplicationFile"("spaceId");

-- CreateIndex
CREATE INDEX "HiringComment_applicationId_idx" ON "HiringComment"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringApplicationNotification_uuid_key" ON "HiringApplicationNotification"("uuid");

-- CreateIndex
CREATE INDEX "HiringApplicationNotification_applicationId_idx" ON "HiringApplicationNotification"("applicationId");

-- CreateIndex
CREATE INDEX "HiringBlacklist_spaceId_phoneHash_idx" ON "HiringBlacklist"("spaceId", "phoneHash");

-- CreateIndex
CREATE INDEX "HiringMessageTemplate_spaceId_idx" ON "HiringMessageTemplate"("spaceId");

-- AddForeignKey
ALTER TABLE "HiringStore" ADD CONSTRAINT "HiringStore_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPosition" ADD CONSTRAINT "HiringPosition_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPosting" ADD CONSTRAINT "HiringPosting_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPostingPosition" ADD CONSTRAINT "HiringPostingPosition_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "HiringPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPostingPosition" ADD CONSTRAINT "HiringPostingPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "HiringPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPostingPosition" ADD CONSTRAINT "HiringPostingPosition_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPostingStore" ADD CONSTRAINT "HiringPostingStore_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "HiringPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPostingStore" ADD CONSTRAINT "HiringPostingStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "HiringStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringPostingManager" ADD CONSTRAINT "HiringPostingManager_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "HiringPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringContent" ADD CONSTRAINT "HiringContent_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringContent" ADD CONSTRAINT "HiringContent_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "HiringPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringContent" ADD CONSTRAINT "HiringContent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "HiringDetailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringDetailTemplate" ADD CONSTRAINT "HiringDetailTemplate_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "HiringPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_postingPositionId_fkey" FOREIGN KEY ("postingPositionId") REFERENCES "HiringPostingPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplicationStore" ADD CONSTRAINT "HiringApplicationStore_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplicationStore" ADD CONSTRAINT "HiringApplicationStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "HiringStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplicationFile" ADD CONSTRAINT "HiringApplicationFile_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringComment" ADD CONSTRAINT "HiringComment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplicationNotification" ADD CONSTRAINT "HiringApplicationNotification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringBlacklist" ADD CONSTRAINT "HiringBlacklist_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringMessageTemplate" ADD CONSTRAINT "HiringMessageTemplate_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- DeckApp 카탈로그 시드: 채용 deck 2종 (멱등)
INSERT INTO "DeckApp" ("id", "name", "description", "isActive")
VALUES
  ('hiring-posts', '공고 제작', '채용 공고 작성·발행 — 캔버스 상세, 동적 지원서 폼', true),
  ('hiring-applicants', '지원자 관리', '지원 접수·단계 관리·알림·블랙리스트', true)
ON CONFLICT ("id") DO NOTHING;

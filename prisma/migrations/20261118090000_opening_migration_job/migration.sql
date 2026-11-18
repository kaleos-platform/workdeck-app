-- CreateEnum
CREATE TYPE "OpeningMigrationStatus" AS ENUM ('MATCHED', 'PLANNED', 'BLOCKED', 'APPROVED', 'APPLYING', 'APPLIED', 'GRANTED', 'DONE', 'GRANT_MANUAL', 'FAILED', 'HELD');

-- CreateTable
CREATE TABLE "OpeningMigrationJob" (
    "id" TEXT NOT NULL,
    "openingBrandId" TEXT NOT NULL,
    "userId" TEXT,
    "targetSpaceId" TEXT,
    "status" "OpeningMigrationStatus" NOT NULL DEFAULT 'MATCHED',
    "summary" JSONB,
    "blockReasons" TEXT[],
    "contactHitsEnc" TEXT,
    "contactHitsIv" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "packetDir" TEXT,
    "approvedSnapshot" JSONB,
    "applyStartedAt" TIMESTAMP(3),
    "grantAt" TIMESTAMP(3),
    "mailSentAt" TIMESTAMP(3),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningMigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningMigrationJob_openingBrandId_key" ON "OpeningMigrationJob"("openingBrandId");

-- CreateIndex
CREATE INDEX "OpeningMigrationJob_status_idx" ON "OpeningMigrationJob"("status");

-- CreateIndex
CREATE INDEX "OpeningMigrationJob_userId_idx" ON "OpeningMigrationJob"("userId");

-- AddForeignKey
ALTER TABLE "OpeningMigrationJob" ADD CONSTRAINT "OpeningMigrationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 운영 데이터 테이블 기본 방어: anon/authenticated 직접 접근 차단
ALTER TABLE "OpeningMigrationJob" ENABLE ROW LEVEL SECURITY;

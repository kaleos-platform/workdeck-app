-- CoupangCredential: 판매분석 수집 토글
ALTER TABLE "CoupangCredential" ADD COLUMN "collectVendorSales" BOOLEAN NOT NULL DEFAULT true;

-- Channel: 외부 소스 (위치와 동일 패턴, 소스별 1개 제약)
ALTER TABLE "Channel" ADD COLUMN "externalSource" TEXT;
CREATE UNIQUE INDEX "Channel_spaceId_externalSource_key" ON "Channel"("spaceId", "externalSource");

-- CoupangBackfillJob: 콜드스타트 백필 잡 (워커 폴링)
CREATE TYPE "CoupangBackfillStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "CoupangBackfillJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "status" "CoupangBackfillStatus" NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "collected" INTEGER NOT NULL DEFAULT 0,
    "converted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoupangBackfillJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoupangBackfillJob_status_createdAt_idx" ON "CoupangBackfillJob"("status", "createdAt");
CREATE INDEX "CoupangBackfillJob_workspaceId_status_idx" ON "CoupangBackfillJob"("workspaceId", "status");

ALTER TABLE "CoupangBackfillJob" ADD CONSTRAINT "CoupangBackfillJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

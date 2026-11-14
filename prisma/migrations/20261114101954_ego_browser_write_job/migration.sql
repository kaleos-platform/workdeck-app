-- CreateEnum
CREATE TYPE "BrowserWriteJobStatus" AS ENUM ('PENDING', 'RUNNING', 'RESTORED', 'ABORTED', 'UNCERTAIN', 'EXPIRED');

-- CreateTable
CREATE TABLE "BrowserWriteJob" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" "BrowserWriteJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByTokenId" TEXT,
    "claimId" TEXT,
    "report" JSONB,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserWriteJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserWriteJob_actionId_key" ON "BrowserWriteJob"("actionId");

-- CreateIndex
CREATE INDEX "BrowserWriteJob_spaceId_status_createdAt_idx" ON "BrowserWriteJob"("spaceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "BrowserWriteJob" ADD CONSTRAINT "BrowserWriteJob_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserWriteJob" ADD CONSTRAINT "BrowserWriteJob_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AgentPendingAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data API의 클라이언트 역할은 승인된 브라우저 작업에 직접 접근하지 못한다.
ALTER TABLE "BrowserWriteJob" ENABLE ROW LEVEL SECURITY;

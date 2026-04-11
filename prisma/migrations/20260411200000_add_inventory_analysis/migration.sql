-- CreateTable
CREATE TABLE "InventoryAnalysis" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "analysedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredBy" TEXT NOT NULL DEFAULT 'manual',
    "results" JSONB NOT NULL,
    "shortageCount" INTEGER NOT NULL DEFAULT 0,
    "returnRateCount" INTEGER NOT NULL DEFAULT 0,
    "storageFeeCount" INTEGER NOT NULL DEFAULT 0,
    "winnerIssueCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryAnalysis_workspaceId_analysedAt_idx" ON "InventoryAnalysis"("workspaceId", "analysedAt" DESC);

-- AddForeignKey
ALTER TABLE "InventoryAnalysis" ADD CONSTRAINT "InventoryAnalysis_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

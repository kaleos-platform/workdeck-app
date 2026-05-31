-- AlterTable
ALTER TABLE "InvProductOption" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InvProductOption_deletedAt_idx" ON "InvProductOption"("deletedAt");

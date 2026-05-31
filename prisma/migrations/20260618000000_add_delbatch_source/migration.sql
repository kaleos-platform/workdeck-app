-- CreateEnum
CREATE TYPE "DelBatchSource" AS ENUM ('MANUAL', 'IMPORT');

-- AlterTable
ALTER TABLE "DelBatch" ADD COLUMN     "source" "DelBatchSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "DelBatch_spaceId_source_idx" ON "DelBatch"("spaceId", "source");

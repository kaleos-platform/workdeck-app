-- CreateTable
CREATE TABLE "HiringFileDeletion" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "paths" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringFileDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringFileDeletion_createdAt_idx" ON "HiringFileDeletion"("createdAt");


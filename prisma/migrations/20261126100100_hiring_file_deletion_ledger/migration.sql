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


-- 삭제 원장은 서버(service role·Prisma)만 접근한다. 공개 anon/authenticated 키 접근 차단.
ALTER TABLE "HiringFileDeletion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "HiringFileDeletion" FROM PUBLIC, anon, authenticated;

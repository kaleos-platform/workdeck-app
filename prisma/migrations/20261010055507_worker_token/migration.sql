-- CreateTable
CREATE TABLE "WorkerToken" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WorkerToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerToken_tokenHash_key" ON "WorkerToken"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkerToken_spaceId_idx" ON "WorkerToken"("spaceId");

-- AddForeignKey
ALTER TABLE "WorkerToken" ADD CONSTRAINT "WorkerToken_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data API 잠금 유지 (rls-lockdown.e2e.test.ts 가 검사)
ALTER TABLE "WorkerToken" ENABLE ROW LEVEL SECURITY;

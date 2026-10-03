-- CreateTable
CREATE TABLE "HiringUploadSession" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "postingId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "applicationId" TEXT,
    "requestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringMigrationRecord" (
    "id" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "sourceSnapshotAt" TIMESTAMP(3) NOT NULL,
    "transformVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "targetModel" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetHash" TEXT NOT NULL,
    "sourceSnapshotEnc" TEXT,
    "sourceSnapshotIv" TEXT,
    "metadata" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringMigrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HiringUploadSession_applicationId_key" ON "HiringUploadSession"("applicationId");

-- CreateIndex
CREATE INDEX "HiringUploadSession_expiresAt_completedAt_idx" ON "HiringUploadSession"("expiresAt", "completedAt");

-- CreateIndex
CREATE INDEX "HiringUploadSession_postingId_createdAt_idx" ON "HiringUploadSession"("postingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringMigrationRecord_sourceRef_key" ON "HiringMigrationRecord"("sourceRef");

-- CreateIndex
CREATE INDEX "HiringMigrationRecord_spaceId_sourceSnapshotAt_idx" ON "HiringMigrationRecord"("spaceId", "sourceSnapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "HiringMigrationRecord_targetModel_targetId_key" ON "HiringMigrationRecord"("targetModel", "targetId");

-- AddForeignKey
ALTER TABLE "HiringUploadSession" ADD CONSTRAINT "HiringUploadSession_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringUploadSession" ADD CONSTRAINT "HiringUploadSession_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "HiringPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringMigrationRecord" ADD CONSTRAINT "HiringMigrationRecord_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 개인정보 및 업로드 권한은 서버에서만 접근한다.
ALTER TABLE "HiringUploadSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HiringMigrationRecord" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "HiringUploadSession", "HiringMigrationRecord" FROM anon, authenticated;

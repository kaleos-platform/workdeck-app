-- CreateEnum
CREATE TYPE "ScFaceStatus" AS ENUM ('UNKNOWN', 'NO_FACE', 'FACE');

-- CreateEnum
CREATE TYPE "ScPublishRequestState" AS ENUM ('RECEIVED', 'NEEDS_INPUT', 'READY', 'PROPOSED', 'APPROVED', 'CANCELED', 'FAILED');

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "sourceVersionId" TEXT;

-- CreateTable
CREATE TABLE "ScNotionConnection" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "sourceDataSourceId" TEXT NOT NULL,
    "requestDataSourceId" TEXT NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScNotionConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScDriveConnection" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "serviceAccountEmail" TEXT NOT NULL,
    "rootId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScDriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScSource" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "driveFolderId" TEXT,
    "latestVersion" INTEGER NOT NULL DEFAULT 0,
    "lastImportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScSourceVersion" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "rawText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScSourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScMedia" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "sourceId" TEXT,
    "driveFileId" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "md5" TEXT,
    "driveModifiedAt" TIMESTAMP(3) NOT NULL,
    "takenAt" TIMESTAMP(3),
    "width" INTEGER,
    "height" INTEGER,
    "caption" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "faceStatus" "ScFaceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "allowedByUserId" TEXT,
    "allowedAt" TIMESTAMP(3),
    "allowedMd5" TEXT,
    "describedAt" TIMESTAMP(3),
    "describeError" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScPublishRequest" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "revision" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceVersionId" TEXT,
    "state" "ScPublishRequestState" NOT NULL DEFAULT 'RECEIVED',
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "contentId" TEXT,
    "projectedStatus" TEXT,
    "projectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScPublishRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScMediaCopy" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "md5" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScMediaCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScNotionConnection_spaceId_key" ON "ScNotionConnection"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScDriveConnection_spaceId_key" ON "ScDriveConnection"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScDriveConnection_serviceAccountEmail_key" ON "ScDriveConnection"("serviceAccountEmail");

-- CreateIndex
CREATE UNIQUE INDEX "ScSource_spaceId_notionPageId_key" ON "ScSource"("spaceId", "notionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "ScSourceVersion_sourceId_version_key" ON "ScSourceVersion"("sourceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ScSourceVersion_sourceId_contentHash_key" ON "ScSourceVersion"("sourceId", "contentHash");

-- CreateIndex
CREATE INDEX "ScMedia_sourceId_idx" ON "ScMedia"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScMedia_spaceId_driveFileId_key" ON "ScMedia"("spaceId", "driveFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ScPublishRequest_contentId_key" ON "ScPublishRequest"("contentId");

-- CreateIndex
CREATE INDEX "ScPublishRequest_spaceId_state_idx" ON "ScPublishRequest"("spaceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ScPublishRequest_spaceId_notionPageId_key" ON "ScPublishRequest"("spaceId", "notionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "ScMediaCopy_requestId_mediaId_md5_key" ON "ScMediaCopy"("requestId", "mediaId", "md5");

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "ScSourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScNotionConnection" ADD CONSTRAINT "ScNotionConnection_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScDriveConnection" ADD CONSTRAINT "ScDriveConnection_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScSource" ADD CONSTRAINT "ScSource_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScSourceVersion" ADD CONSTRAINT "ScSourceVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ScSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScMedia" ADD CONSTRAINT "ScMedia_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScMedia" ADD CONSTRAINT "ScMedia_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ScSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScPublishRequest" ADD CONSTRAINT "ScPublishRequest_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScPublishRequest" ADD CONSTRAINT "ScPublishRequest_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ScSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScPublishRequest" ADD CONSTRAINT "ScPublishRequest_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "ScSourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScPublishRequest" ADD CONSTRAINT "ScPublishRequest_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScMediaCopy" ADD CONSTRAINT "ScMediaCopy_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScMediaCopy" ADD CONSTRAINT "ScMediaCopy_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ScPublishRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScMediaCopy" ADD CONSTRAINT "ScMediaCopy_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "ScMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS: 앱은 Prisma(서비스 역할)로만 접근한다. anon/authenticated 직접 접근 차단.
ALTER TABLE "ScNotionConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScDriveConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScSourceVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScMedia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScPublishRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScMediaCopy" ENABLE ROW LEVEL SECURITY;

-- CreateEnum
CREATE TYPE "CoupangDataSource" AS ENUM ('CRAWL', 'API');

-- AlterTable
ALTER TABLE "CollectionRun" ADD COLUMN     "probeApi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "probeResult" JSONB,
ADD COLUMN     "source" "CoupangDataSource" NOT NULL DEFAULT 'CRAWL';

-- AlterTable
ALTER TABLE "InventoryUpload" ADD COLUMN     "source" "CoupangDataSource" NOT NULL DEFAULT 'CRAWL';

-- AlterTable
ALTER TABLE "InventoryRecord" ADD COLUMN     "source" "CoupangDataSource" NOT NULL DEFAULT 'CRAWL';

-- CreateTable
CREATE TABLE "CoupangApiCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "encryptionIv" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoupangApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoupangSourceSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inventorySource" "CoupangDataSource" NOT NULL DEFAULT 'CRAWL',
    "salesSource" "CoupangDataSource" NOT NULL DEFAULT 'CRAWL',
    "settlementSource" "CoupangDataSource" NOT NULL DEFAULT 'CRAWL',
    "productSource" "CoupangDataSource" NOT NULL DEFAULT 'CRAWL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoupangSourceSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoupangApiCredential_workspaceId_key" ON "CoupangApiCredential"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CoupangSourceSetting_workspaceId_key" ON "CoupangSourceSetting"("workspaceId");

-- AddForeignKey
ALTER TABLE "CoupangApiCredential" ADD CONSTRAINT "CoupangApiCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoupangSourceSetting" ADD CONSTRAINT "CoupangSourceSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


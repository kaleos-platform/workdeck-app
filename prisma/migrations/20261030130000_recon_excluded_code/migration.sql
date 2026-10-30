-- CreateTable
CREATE TABLE "InvReconExcludedCode" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "externalName" TEXT,
    "externalOptionName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvReconExcludedCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvReconExcludedCode_spaceId_idx" ON "InvReconExcludedCode"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvReconExcludedCode_locationId_externalCode_key" ON "InvReconExcludedCode"("locationId", "externalCode");

-- AddForeignKey
ALTER TABLE "InvReconExcludedCode" ADD CONSTRAINT "InvReconExcludedCode_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvReconExcludedCode" ADD CONSTRAINT "InvReconExcludedCode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InvStorageLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


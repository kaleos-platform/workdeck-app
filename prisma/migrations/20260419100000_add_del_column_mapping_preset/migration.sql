-- CreateTable
CREATE TABLE "DelColumnMappingPreset" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelColumnMappingPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DelColumnMappingPreset_spaceId_idx" ON "DelColumnMappingPreset"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DelColumnMappingPreset_spaceId_name_key" ON "DelColumnMappingPreset"("spaceId", "name");

-- AddForeignKey
ALTER TABLE "DelColumnMappingPreset" ADD CONSTRAINT "DelColumnMappingPreset_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

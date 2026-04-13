CREATE TYPE "InvMovementType" AS ENUM ('INBOUND', 'OUTBOUND', 'RETURN', 'TRANSFER', 'ADJUSTMENT');
CREATE TYPE "InvReconciliationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InvChannelGroup" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "InvChannelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvImportHistory" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "successRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "errors" JSONB,
    "importedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "InvImportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvLocationProductMap" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "externalName" TEXT,
    "externalOptionName" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "InvLocationProductMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvMovement" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "toLocationId" TEXT,
    "channelId" TEXT,
    "type" "InvMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "orderDate" TIMESTAMP(3),
    "reason" TEXT,
    "referenceId" TEXT,
    "importHistoryId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "InvMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvProduct" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvReconciliation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "status" "InvReconciliationStatus" DEFAULT 'PENDING'::"InvReconciliationStatus" NOT NULL,
    "matchResults" JSONB NOT NULL,
    "totalItems" INTEGER NOT NULL,
    "matchedItems" INTEGER NOT NULL,
    "adjustedItems" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    CONSTRAINT "InvReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvReorderConfig" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "leadTimeDays" INTEGER DEFAULT 7 NOT NULL,
    "safetyStockQty" INTEGER DEFAULT 0 NOT NULL,
    "analysisWindowDays" INTEGER DEFAULT 90 NOT NULL,
    CONSTRAINT "InvReorderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvSalesChannel" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" TEXT,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "InvSalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvSettings" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "defaultLocationId" TEXT,
    "slackWebhookUrl" TEXT,
    "preferences" JSONB DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT "InvSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvStockLevel" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER DEFAULT 0 NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvStockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvStorageLocation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvStorageLocation_pkey" PRIMARY KEY ("id")
);

-- Indexes:
CREATE INDEX "InvChannelGroup_spaceId_idx" ON public."InvChannelGroup" USING btree ("spaceId");
CREATE INDEX "InvImportHistory_spaceId_idx" ON public."InvImportHistory" USING btree ("spaceId");
CREATE UNIQUE INDEX "InvLocationProductMap_locationId_externalCode_key" ON public."InvLocationProductMap" USING btree ("locationId", "externalCode");
CREATE INDEX "InvLocationProductMap_optionId_idx" ON public."InvLocationProductMap" USING btree ("optionId");
CREATE INDEX "InvLocationProductMap_spaceId_idx" ON public."InvLocationProductMap" USING btree ("spaceId");
CREATE INDEX "InvMovement_locationId_idx" ON public."InvMovement" USING btree ("locationId");
CREATE INDEX "InvMovement_optionId_idx" ON public."InvMovement" USING btree ("optionId");
CREATE INDEX "InvMovement_spaceId_idx" ON public."InvMovement" USING btree ("spaceId");
CREATE INDEX "InvMovement_spaceId_movementDate_idx" ON public."InvMovement" USING btree ("spaceId", "movementDate");
CREATE UNIQUE INDEX "InvProduct_spaceId_code_key" ON public."InvProduct" USING btree ("spaceId", code);
CREATE INDEX "InvProduct_spaceId_idx" ON public."InvProduct" USING btree ("spaceId");
CREATE INDEX "InvProductOption_productId_idx" ON public."InvProductOption" USING btree ("productId");
CREATE INDEX "InvReconciliation_spaceId_idx" ON public."InvReconciliation" USING btree ("spaceId");
CREATE INDEX "InvReorderConfig_optionId_idx" ON public."InvReorderConfig" USING btree ("optionId");
CREATE UNIQUE INDEX "InvReorderConfig_optionId_key" ON public."InvReorderConfig" USING btree ("optionId");
CREATE INDEX "InvSalesChannel_groupId_idx" ON public."InvSalesChannel" USING btree ("groupId");
CREATE INDEX "InvSalesChannel_spaceId_idx" ON public."InvSalesChannel" USING btree ("spaceId");
CREATE INDEX "InvSettings_spaceId_idx" ON public."InvSettings" USING btree ("spaceId");
CREATE UNIQUE INDEX "InvSettings_spaceId_key" ON public."InvSettings" USING btree ("spaceId");
CREATE UNIQUE INDEX "InvStockLevel_optionId_locationId_key" ON public."InvStockLevel" USING btree ("optionId", "locationId");
CREATE INDEX "InvStockLevel_spaceId_idx" ON public."InvStockLevel" USING btree ("spaceId");
CREATE INDEX "InvStorageLocation_spaceId_idx" ON public."InvStorageLocation" USING btree ("spaceId");

-- Foreign Keys:
ALTER TABLE "InvChannelGroup" ADD CONSTRAINT "InvChannelGroup_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvImportHistory" ADD CONSTRAINT "InvImportHistory_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvLocationProductMap" ADD CONSTRAINT "InvLocationProductMap_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InvStorageLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvLocationProductMap" ADD CONSTRAINT "InvLocationProductMap_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvLocationProductMap" ADD CONSTRAINT "InvLocationProductMap_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "InvSalesChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_importHistoryId_fkey" FOREIGN KEY ("importHistoryId") REFERENCES "InvImportHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InvStorageLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "InvStorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvProductOption" ADD CONSTRAINT "InvProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvReconciliation" ADD CONSTRAINT "InvReconciliation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InvStorageLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvReconciliation" ADD CONSTRAINT "InvReconciliation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvReorderConfig" ADD CONSTRAINT "InvReorderConfig_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvSalesChannel" ADD CONSTRAINT "InvSalesChannel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InvChannelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvSalesChannel" ADD CONSTRAINT "InvSalesChannel_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvSettings" ADD CONSTRAINT "InvSettings_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "InvStorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvSettings" ADD CONSTRAINT "InvSettings_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvStockLevel" ADD CONSTRAINT "InvStockLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InvStorageLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvStockLevel" ADD CONSTRAINT "InvStockLevel_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvStockLevel" ADD CONSTRAINT "InvStockLevel_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvStorageLocation" ADD CONSTRAINT "InvStorageLocation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

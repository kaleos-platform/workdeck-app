-- CreateTable: InventoryUpload
CREATE TABLE "InventoryUpload" (
  "id" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshotDate" TIMESTAMP(3) NOT NULL,
  "totalRows" INTEGER,
  "insertedRows" INTEGER,
  "workspaceId" TEXT NOT NULL,
  CONSTRAINT "InventoryUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryRecord
CREATE TABLE "InventoryRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "snapshotDate" TIMESTAMP(3) NOT NULL,
  "fileType" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "skuId" TEXT,
  "productName" TEXT NOT NULL,
  "optionName" TEXT,
  "category" TEXT,
  "availableStock" INTEGER,
  "inboundStock" INTEGER,
  "productGrade" TEXT,
  "restockQty" INTEGER,
  "restockDate" TEXT,
  "estimatedDepletion" TEXT,
  "storageFee" INTEGER,
  "isItemWinner" BOOLEAN,
  "returns30d" INTEGER,
  "revenue7d" DECIMAL(18,2),
  "revenue30d" DECIMAL(18,2),
  "salesQty7d" INTEGER,
  "salesQty30d" INTEGER,
  "visitors" INTEGER,
  "views" INTEGER,
  "cartAdds" INTEGER,
  "conversionRate" DECIMAL(10,4),
  "itemWinnerRate" DECIMAL(10,4),
  "totalRevenue" DECIMAL(18,2),
  "totalSales" INTEGER,
  "totalCancelAmt" DECIMAL(18,2),
  "totalCancelled" INTEGER,
  "stock1to30d" INTEGER,
  "stock31to45d" INTEGER,
  "stock46to60d" INTEGER,
  "stock61to120d" INTEGER,
  "stock121to180d" INTEGER,
  "stock181plusD" INTEGER,
  "uploadId" TEXT NOT NULL,
  CONSTRAINT "InventoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryUpload_workspaceId_idx" ON "InventoryUpload"("workspaceId");
CREATE UNIQUE INDEX "InventoryRecord_workspaceId_snapshotDate_productId_optionId_fileType_key" ON "InventoryRecord"("workspaceId", "snapshotDate", "productId", "optionId", "fileType");
CREATE INDEX "InventoryRecord_workspaceId_snapshotDate_idx" ON "InventoryRecord"("workspaceId", "snapshotDate");
CREATE INDEX "InventoryRecord_workspaceId_productName_idx" ON "InventoryRecord"("workspaceId", "productName");

-- AddForeignKey
ALTER TABLE "InventoryUpload" ADD CONSTRAINT "InventoryUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "InventoryUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

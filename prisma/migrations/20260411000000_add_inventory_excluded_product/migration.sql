-- CreateTable
CREATE TABLE "InventoryExcludedProduct" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "excludedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "InventoryExcludedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryExcludedProduct_workspaceId_idx" ON "InventoryExcludedProduct"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryExcludedProduct_workspaceId_productId_key" ON "InventoryExcludedProduct"("workspaceId", "productId");

-- AddForeignKey
ALTER TABLE "InventoryExcludedProduct" ADD CONSTRAINT "InventoryExcludedProduct_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

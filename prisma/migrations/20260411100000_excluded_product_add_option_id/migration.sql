-- Drop existing unique constraint on (workspaceId, productId)
DROP INDEX IF EXISTS "InventoryExcludedProduct_workspaceId_productId_key";

-- Add optionId column (non-nullable with default for existing rows)
ALTER TABLE "InventoryExcludedProduct" ADD COLUMN "optionId" TEXT NOT NULL DEFAULT '';

-- Create new unique constraint on (workspaceId, optionId)
CREATE UNIQUE INDEX "InventoryExcludedProduct_workspaceId_optionId_key" ON "InventoryExcludedProduct"("workspaceId", "optionId");

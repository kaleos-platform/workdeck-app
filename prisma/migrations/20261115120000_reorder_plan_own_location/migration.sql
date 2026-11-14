-- AlterTable
ALTER TABLE "ReorderPlan" ADD COLUMN     "ownLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "ReorderPlan" ADD CONSTRAINT "ReorderPlan_ownLocationId_fkey" FOREIGN KEY ("ownLocationId") REFERENCES "InvStorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


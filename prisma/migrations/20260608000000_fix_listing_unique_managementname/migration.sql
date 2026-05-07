-- DropIndex
DROP INDEX "ProductListing_channelId_searchName_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProductListing_channelId_managementName_key" ON "ProductListing"("channelId", "managementName");

-- DropIndex
DROP INDEX "SpaceSlackChannel_spaceId_kind_key";

-- CreateIndex
CREATE UNIQUE INDEX "SpaceSlackChannel_spaceId_kind_channelId_key" ON "SpaceSlackChannel"("spaceId", "kind", "channelId");


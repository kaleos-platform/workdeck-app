-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "approvalLimitKrw" INTEGER;

-- AlterTable
ALTER TABLE "SpaceMember" ADD COLUMN     "slackUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMember_spaceId_slackUserId_key" ON "SpaceMember"("spaceId", "slackUserId");

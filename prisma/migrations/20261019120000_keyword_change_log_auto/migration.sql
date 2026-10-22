-- AlterTable
ALTER TABLE "KeywordChangeLog" ADD COLUMN     "channelProductId" TEXT,
ALTER COLUMN "reason" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "KeywordChangeLog_channelProductId_createdAt_idx" ON "KeywordChangeLog"("channelProductId", "createdAt");

-- AddForeignKey
ALTER TABLE "KeywordChangeLog" ADD CONSTRAINT "KeywordChangeLog_channelProductId_fkey" FOREIGN KEY ("channelProductId") REFERENCES "ChannelProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "InvProductGroup" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvProductGroup_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "InvProduct" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InvProductGroup_spaceId_name_key" ON "InvProductGroup"("spaceId", "name");

-- CreateIndex
CREATE INDEX "InvProductGroup_spaceId_idx" ON "InvProductGroup"("spaceId");

-- CreateIndex
CREATE INDEX "InvProduct_groupId_idx" ON "InvProduct"("groupId");

-- AddForeignKey
ALTER TABLE "InvProductGroup" ADD CONSTRAINT "InvProductGroup_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvProduct" ADD CONSTRAINT "InvProduct_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

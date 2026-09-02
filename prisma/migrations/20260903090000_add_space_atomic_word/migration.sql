-- CreateTable
CREATE TABLE "SpaceAtomicWord" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceAtomicWord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpaceAtomicWord_spaceId_idx" ON "SpaceAtomicWord"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceAtomicWord_spaceId_normalized_key" ON "SpaceAtomicWord"("spaceId", "normalized");

-- AddForeignKey
ALTER TABLE "SpaceAtomicWord" ADD CONSTRAINT "SpaceAtomicWord_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

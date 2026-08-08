-- CreateEnum
CREATE TYPE "SpaceAiMode" AS ENUM ('WORKDECK', 'BYOK');

-- CreateEnum
CREATE TYPE "SpaceAiProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI');

-- AlterTable
ALTER TABLE "WorkspaceAiCredit" ADD COLUMN     "textTokenQuota" INTEGER NOT NULL DEFAULT 300000,
ADD COLUMN     "textTokensUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SpaceAiSetting" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "mode" "SpaceAiMode" NOT NULL DEFAULT 'WORKDECK',
    "provider" "SpaceAiProvider",
    "model" TEXT,
    "encryptedApiKey" TEXT,
    "apiKeyIv" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceAiSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceAiSetting_spaceId_key" ON "SpaceAiSetting"("spaceId");

-- AddForeignKey
ALTER TABLE "SpaceAiSetting" ADD CONSTRAINT "SpaceAiSetting_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "AgentPendingAction" ADD COLUMN     "actorTokenId" TEXT;

-- AlterTable
ALTER TABLE "SpaceAgent" ADD COLUMN     "envSecretsEnabled" BOOLEAN NOT NULL DEFAULT false;


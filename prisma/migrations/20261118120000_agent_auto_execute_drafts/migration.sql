-- AlterTable
ALTER TABLE "SpaceAgentIdentity" ADD COLUMN     "autoExecuteDrafts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoExecuteEnabledAt" TIMESTAMP(3),
ADD COLUMN     "autoExecuteEnabledById" TEXT;


-- AlterEnum
ALTER TYPE "PublisherMode" ADD VALUE 'ASIDE' BEFORE 'MANUAL';

-- AlterEnum
ALTER TYPE "DeploymentStatus" ADD VALUE 'AWAITING_ASSETS' BEFORE 'PUBLISHING';

-- AlterTable
ALTER TABLE "ContentDeployment" ADD COLUMN     "assetPlan" JSONB,
ADD COLUMN     "notifySlackChannelId" TEXT,
ADD COLUMN     "notifySlackThreadTs" TEXT,
ADD COLUMN     "publishAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "publishSnapshot" JSONB;

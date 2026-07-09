-- AlterEnum
ALTER TYPE "BoDeploymentStatus" ADD VALUE 'DELETING';
ALTER TYPE "BoDeploymentStatus" ADD VALUE 'DELETED';

-- AlterEnum
ALTER TYPE "BoJobKind" ADD VALUE 'DELETE_POST';

-- AlterTable
ALTER TABLE "BoDeployment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

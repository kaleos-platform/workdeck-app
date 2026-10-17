-- AlterTable
ALTER TABLE "SpaceCredential" ADD COLUMN     "healthAlertedAt" TIMESTAMP(3),
ADD COLUMN     "healthError" TEXT;

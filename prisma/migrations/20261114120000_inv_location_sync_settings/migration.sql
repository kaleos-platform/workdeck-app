-- AlterTable
ALTER TABLE "InvStorageLocation" ADD COLUMN     "autoReconcileWeekly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncProvider" TEXT,
ADD COLUMN     "syncSecretName" TEXT;


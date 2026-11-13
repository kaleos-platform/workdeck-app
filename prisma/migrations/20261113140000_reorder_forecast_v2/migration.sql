-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReorderForecastModel" ADD VALUE 'MA30';
ALTER TYPE "ReorderForecastModel" ADD VALUE 'MA90';
ALTER TYPE "ReorderForecastModel" ADD VALUE 'MA_BLEND';
ALTER TYPE "ReorderForecastModel" ADD VALUE 'SES_TREND';

-- AlterTable
ALTER TABLE "InvReorderConfig" ADD COLUMN     "excludeFromForecast" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forecastModel" TEXT,
ADD COLUMN     "targetCoverDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN     "externalStockIns" JSONB;

-- AlterTable
ALTER TABLE "ReorderPlanItem" ADD COLUMN     "modelForecasts" JSONB;

-- AlterTable
ALTER TABLE "ReorderPlanAccuracy" ADD COLUMN     "modelWape" JSONB;


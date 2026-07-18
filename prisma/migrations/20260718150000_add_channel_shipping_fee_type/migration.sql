-- CreateEnum
CREATE TYPE "ChannelShippingFeeType" AS ENUM ('FIXED', 'PERCENT');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "shippingFeeType" "ChannelShippingFeeType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN "shippingFeePct" DECIMAL(6,4);

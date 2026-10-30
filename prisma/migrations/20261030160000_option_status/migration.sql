-- CreateEnum
CREATE TYPE "InvOptionStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- AlterTable
ALTER TABLE "InvProductOption" ADD COLUMN     "status" "InvOptionStatus" NOT NULL DEFAULT 'ACTIVE';


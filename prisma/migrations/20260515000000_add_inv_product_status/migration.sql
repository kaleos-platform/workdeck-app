CREATE TYPE "InvProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "InvProduct"
  ADD COLUMN "status" "InvProductStatus" NOT NULL DEFAULT 'ACTIVE';

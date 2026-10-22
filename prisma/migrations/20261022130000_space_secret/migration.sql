-- CreateEnum
CREATE TYPE "SecretKind" AS ENUM ('API_KEY', 'LOGIN', 'ENV');

-- CreateTable
CREATE TABLE "SpaceSecret" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SecretKind" NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "allowedAgentIds" TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceSecret_spaceId_name_key" ON "SpaceSecret"("spaceId", "name");

-- AddForeignKey
ALTER TABLE "SpaceSecret" ADD CONSTRAINT "SpaceSecret_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "SpaceSecret" ENABLE ROW LEVEL SECURITY;

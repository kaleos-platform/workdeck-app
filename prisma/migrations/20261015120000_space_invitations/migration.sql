-- CreateTable
CREATE TABLE "SpaceInvitation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "SpaceMemberRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceInvitation_tokenHash_key" ON "SpaceInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "SpaceInvitation_spaceId_email_idx" ON "SpaceInvitation"("spaceId", "email");

-- AddForeignKey
ALTER TABLE "SpaceInvitation" ADD CONSTRAINT "SpaceInvitation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS: 앱은 Prisma(서비스 역할)로만 접근한다.
ALTER TABLE "SpaceInvitation" ENABLE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "SpaceAgentIdentity" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "oauthClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceAgentIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceAgentIdentity_oauthClientId_key" ON "SpaceAgentIdentity"("oauthClientId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceAgentIdentity_spaceId_name_key" ON "SpaceAgentIdentity"("spaceId", "name");

-- CreateIndex
CREATE INDEX "AgentToken_agentId_idx" ON "AgentToken"("agentId");

-- AddForeignKey
ALTER TABLE "SpaceAgentIdentity" ADD CONSTRAINT "SpaceAgentIdentity_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToken" ADD CONSTRAINT "AgentToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SpaceAgentIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- PR #1060 기본 권한 회수와 짝: 새 테이블도 Data API에서 막는다.
ALTER TABLE "SpaceAgentIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentToken" ENABLE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "ToolAuditLog" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requesterUserId" TEXT,
    "tool" TEXT NOT NULL,
    "argsSummary" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER,
    "decryptedCredentialIds" TEXT[],
    "actionId" TEXT,
    "deciderUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requesterUserId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "planClass" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6),
    "workId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceCredential" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "config" JSONB,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolAuditLog_spaceId_createdAt_idx" ON "ToolAuditLog"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolAuditLog_workId_idx" ON "ToolAuditLog"("workId");

-- CreateIndex
CREATE INDEX "UsageEvent_spaceId_createdAt_idx" ON "UsageEvent"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_workId_idx" ON "UsageEvent"("workId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceCredential_spaceId_provider_key" ON "SpaceCredential"("spaceId", "provider");

-- AddForeignKey
ALTER TABLE "ToolAuditLog" ADD CONSTRAINT "ToolAuditLog_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceCredential" ADD CONSTRAINT "SpaceCredential_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS
ALTER TABLE "ToolAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SpaceCredential" ENABLE ROW LEVEL SECURITY;

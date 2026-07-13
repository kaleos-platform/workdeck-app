-- CreateEnum
CREATE TYPE "AgentActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentActionSource" AS ENUM ('MCP', 'WORKDECK_AGENT', 'WEB', 'SYSTEM');

-- CreateTable
CREATE TABLE "AgentPendingAction" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "deckKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "beforeState" JSONB,
    "source" "AgentActionSource" NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" "AgentActionStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "idempotencyKey" TEXT,
    "slackChannelId" TEXT,
    "slackMessageTs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentPendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPendingAction_idempotencyKey_key" ON "AgentPendingAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentPendingAction_spaceId_status_createdAt_idx" ON "AgentPendingAction"("spaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPendingAction_status_expiresAt_idx" ON "AgentPendingAction"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "AgentPendingAction" ADD CONSTRAINT "AgentPendingAction_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

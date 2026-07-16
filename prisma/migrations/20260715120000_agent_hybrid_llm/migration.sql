-- M4 하이브리드 에이전트: Space별 활성 토글 + LLM 일일 사용량 + 대화 세션.

-- Space별 workdeck 에이전트 활성 여부 (레코드 없으면 앱에서 기본 활성으로 취급).
CREATE TABLE "SpaceAgent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceAgent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpaceAgent_spaceId_key" ON "SpaceAgent"("spaceId");

ALTER TABLE "SpaceAgent" ADD CONSTRAINT "SpaceAgent_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- LLM 사용량 일일 집계 (rate limit). date = KST "YYYY-MM-DD".
CREATE TABLE "AgentLlmUsage" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLlmUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentLlmUsage_spaceId_date_key" ON "AgentLlmUsage"("spaceId", "date");

ALTER TABLE "AgentLlmUsage" ADD CONSTRAINT "AgentLlmUsage_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Slack 스레드 = 대화 세션. messages = 최근 20턴 [{role, content}].
CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadTs" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentConversation_channelId_threadTs_key" ON "AgentConversation"("channelId", "threadTs");

CREATE INDEX "AgentConversation_updatedAt_idx" ON "AgentConversation"("updatedAt");

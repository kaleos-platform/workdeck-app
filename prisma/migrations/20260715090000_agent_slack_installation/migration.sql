-- CreateTable
CREATE TABLE "SlackInstallation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT,
    "botUserId" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "botTokenIv" TEXT NOT NULL,
    "scope" TEXT,
    "installedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SlackInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceSlackChannel" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'approvals',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpaceSlackChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlackInstallation_spaceId_key" ON "SlackInstallation"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackInstallation_teamId_key" ON "SlackInstallation"("teamId");

-- CreateIndex
CREATE INDEX "SpaceSlackChannel_channelId_idx" ON "SpaceSlackChannel"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceSlackChannel_spaceId_kind_key" ON "SpaceSlackChannel"("spaceId", "kind");

-- AddForeignKey
ALTER TABLE "SlackInstallation" ADD CONSTRAINT "SlackInstallation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceSlackChannel" ADD CONSTRAINT "SpaceSlackChannel_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "SlackInstallation"("spaceId") ON DELETE CASCADE ON UPDATE CASCADE;

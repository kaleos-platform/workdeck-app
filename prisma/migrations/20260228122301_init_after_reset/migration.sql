-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportUpload" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalRows" INTEGER,
    "insertedRows" INTEGER,
    "duplicateRows" INTEGER,
    "skippedRows" INTEGER,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "ReportUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdRecord" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "adGroup" TEXT,
    "placement" TEXT,
    "productName" TEXT,
    "optionId" TEXT,
    "salesOptionId" TEXT,
    "keyword" TEXT,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "adCost" DECIMAL(18,2) NOT NULL,
    "ctr" DECIMAL(10,4) NOT NULL,
    "orders1d" INTEGER NOT NULL,
    "revenue1d" DECIMAL(18,2) NOT NULL,
    "roas1d" DECIMAL(10,4) NOT NULL,
    "material" TEXT,
    "videoViews3s" INTEGER,
    "avgPlayTime" DECIMAL(10,2),
    "videoViews25p" INTEGER,
    "videoViews50p" INTEGER,
    "videoViews75p" INTEGER,
    "videoViews100p" INTEGER,
    "costPerView3s" DECIMAL(18,2),
    "engagements" INTEGER,
    "engagementRate" DECIMAL(10,4),
    "workspaceId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,

    CONSTRAINT "AdRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMeta" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isCustomName" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordStatus" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedMemo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTarget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "dailyBudget" INTEGER,
    "targetRoas" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMemo" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMemo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerId_key" ON "Workspace"("ownerId");

-- CreateIndex
CREATE INDEX "ReportUpload_workspaceId_idx" ON "ReportUpload"("workspaceId");

-- CreateIndex
CREATE INDEX "AdRecord_workspaceId_campaignId_idx" ON "AdRecord"("workspaceId", "campaignId");

-- CreateIndex
CREATE INDEX "AdRecord_workspaceId_date_idx" ON "AdRecord"("workspaceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdRecord_workspaceId_date_campaignId_adType_keyword_adGroup_key" ON "AdRecord"("workspaceId", "date", "campaignId", "adType", "keyword", "adGroup", "optionId", "placement", "material", "salesOptionId");

-- CreateIndex
CREATE INDEX "CampaignMeta_workspaceId_idx" ON "CampaignMeta"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMeta_workspaceId_campaignId_key" ON "CampaignMeta"("workspaceId", "campaignId");

-- CreateIndex
CREATE INDEX "KeywordStatus_workspaceId_campaignId_idx" ON "KeywordStatus"("workspaceId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordStatus_workspaceId_campaignId_keyword_key" ON "KeywordStatus"("workspaceId", "campaignId", "keyword");

-- CreateIndex
CREATE INDEX "CampaignTarget_workspaceId_campaignId_effectiveDate_idx" ON "CampaignTarget"("workspaceId", "campaignId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTarget_workspaceId_campaignId_effectiveDate_key" ON "CampaignTarget"("workspaceId", "campaignId", "effectiveDate");

-- CreateIndex
CREATE INDEX "DailyMemo_workspaceId_campaignId_idx" ON "DailyMemo"("workspaceId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMemo_workspaceId_campaignId_date_key" ON "DailyMemo"("workspaceId", "campaignId", "date");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportUpload" ADD CONSTRAINT "ReportUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRecord" ADD CONSTRAINT "AdRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRecord" ADD CONSTRAINT "AdRecord_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMeta" ADD CONSTRAINT "CampaignMeta_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordStatus" ADD CONSTRAINT "KeywordStatus_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMemo" ADD CONSTRAINT "DailyMemo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

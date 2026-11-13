-- CreateTable
CREATE TABLE "HiringPostingMailSetting" (
    "postingId" TEXT NOT NULL,
    "applicantReceiptEmail" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringPostingMailSetting_pkey" PRIMARY KEY ("postingId")
);

-- CreateTable
CREATE TABLE "HiringDailyDigestLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "digestDate" TEXT NOT NULL,
    "postingCount" INTEGER NOT NULL,
    "applicationCount" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringDailyDigestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HiringDailyDigestLog_userId_digestDate_key" ON "HiringDailyDigestLog"("userId", "digestDate");

-- AddForeignKey
ALTER TABLE "HiringPostingMailSetting" ADD CONSTRAINT "HiringPostingMailSetting_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "HiringPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data API 잠금
ALTER TABLE "HiringPostingMailSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HiringDailyDigestLog" ENABLE ROW LEVEL SECURITY;

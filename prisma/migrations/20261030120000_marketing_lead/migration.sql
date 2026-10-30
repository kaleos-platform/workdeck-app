-- CreateEnum
CREATE TYPE "MarketingLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'DROPPED');

-- CreateTable
CREATE TABLE "MarketingLead" (
    "id" TEXT NOT NULL,
    "deck" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "phoneIv" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "employeeCount" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "utm" JSONB,
    "referrer" TEXT,
    "status" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW',
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingLead_createdAt_idx" ON "MarketingLead"("createdAt");

-- CreateIndex
CREATE INDEX "MarketingLead_email_idx" ON "MarketingLead"("email");

ALTER TABLE "MarketingLead" ENABLE ROW LEVEL SECURITY;

-- CreateEnum
CREATE TYPE "FinAccountKind" AS ENUM ('BANK', 'CARD');

-- CreateEnum
CREATE TYPE "FinCategoryType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "FinClassRuleMatchType" AS ENUM ('EXACT', 'KEYWORD');

-- CreateEnum
CREATE TYPE "FinClassRuleSource" AS ENUM ('USER', 'SEED');

-- CreateEnum
CREATE TYPE "FinImportStatus" AS ENUM ('DRAFT', 'COMMITTED');

-- CreateEnum
CREATE TYPE "FinTxnDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "FinClassStatus" AS ENUM ('CLASSIFIED', 'REVIEW', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "FinStagedResolution" AS ENUM ('NEW', 'DUP_SAME', 'DUP_CHANGED');

-- CreateEnum
CREATE TYPE "FinSnapshotSource" AS ENUM ('DERIVED', 'MANUAL');

-- CreateTable
CREATE TABLE "FinAccount" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinAccountKind" NOT NULL,
    "institution" TEXT NOT NULL,
    "accountNumber" TEXT,
    "accountType" TEXT,
    "openingBalance" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinLiability" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lender" TEXT,
    "principal" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "rate" TEXT,
    "dueDate" TEXT,
    "monthlyPayment" DECIMAL(18,2),
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinLiability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinCategory" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "alias" TEXT,
    "type" "FinCategoryType" NOT NULL,
    "groupLabel" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinClassRule" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "matchType" "FinClassRuleMatchType" NOT NULL DEFAULT 'EXACT',
    "categoryId" TEXT NOT NULL,
    "learnedFrom" "FinClassRuleSource" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinClassRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinMappingPreset" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "kind" "FinAccountKind" NOT NULL,
    "mapping" JSONB NOT NULL,
    "defaultAccountId" TEXT,
    "dateFormat" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinMappingPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinImport" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "kind" "FinAccountKind" NOT NULL,
    "status" "FinImportStatus" NOT NULL DEFAULT 'DRAFT',
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "committedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinStagedRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "direction" "FinTxnDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2),
    "description" TEXT,
    "counterparty" TEXT,
    "approvalNo" TEXT,
    "cancelFlag" TEXT,
    "categoryId" TEXT,
    "classStatus" "FinClassStatus" NOT NULL DEFAULT 'UNCLASSIFIED',
    "matchedRuleId" TEXT,
    "identityKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "resolution" "FinStagedResolution" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinStagedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinTransaction" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "importId" TEXT,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "direction" "FinTxnDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2),
    "description" TEXT,
    "counterparty" TEXT,
    "memo" TEXT,
    "categoryId" TEXT,
    "isTransfer" BOOLEAN NOT NULL DEFAULT false,
    "classStatus" "FinClassStatus" NOT NULL DEFAULT 'UNCLASSIFIED',
    "matchedRuleId" TEXT,
    "approvalNo" TEXT,
    "cancelFlag" TEXT,
    "identityKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "source" "FinSnapshotSource" NOT NULL DEFAULT 'DERIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinAccount_spaceId_idx" ON "FinAccount"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinAccount_spaceId_accountNumber_key" ON "FinAccount"("spaceId", "accountNumber");

-- CreateIndex
CREATE INDEX "FinLiability_spaceId_idx" ON "FinLiability"("spaceId");

-- CreateIndex
CREATE INDEX "FinCategory_spaceId_idx" ON "FinCategory"("spaceId");

-- CreateIndex
CREATE INDEX "FinCategory_parentId_idx" ON "FinCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinCategory_spaceId_parentId_name_key" ON "FinCategory"("spaceId", "parentId", "name");

-- CreateIndex
CREATE INDEX "FinClassRule_spaceId_idx" ON "FinClassRule"("spaceId");

-- CreateIndex
CREATE INDEX "FinClassRule_categoryId_idx" ON "FinClassRule"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "FinClassRule_spaceId_matchKey_key" ON "FinClassRule"("spaceId", "matchKey");

-- CreateIndex
CREATE INDEX "FinMappingPreset_spaceId_idx" ON "FinMappingPreset"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinMappingPreset_spaceId_name_key" ON "FinMappingPreset"("spaceId", "name");

-- CreateIndex
CREATE INDEX "FinImport_spaceId_idx" ON "FinImport"("spaceId");

-- CreateIndex
CREATE INDEX "FinImport_accountId_idx" ON "FinImport"("accountId");

-- CreateIndex
CREATE INDEX "FinStagedRow_importId_idx" ON "FinStagedRow"("importId");

-- CreateIndex
CREATE INDEX "FinStagedRow_spaceId_idx" ON "FinStagedRow"("spaceId");

-- CreateIndex
CREATE INDEX "FinTransaction_spaceId_txnDate_idx" ON "FinTransaction"("spaceId", "txnDate");

-- CreateIndex
CREATE INDEX "FinTransaction_spaceId_categoryId_idx" ON "FinTransaction"("spaceId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "FinTransaction_spaceId_accountId_identityKey_key" ON "FinTransaction"("spaceId", "accountId", "identityKey");

-- CreateIndex
CREATE INDEX "FinBalanceSnapshot_spaceId_idx" ON "FinBalanceSnapshot"("spaceId");

-- CreateIndex
CREATE INDEX "FinBalanceSnapshot_accountId_idx" ON "FinBalanceSnapshot"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FinBalanceSnapshot_spaceId_accountId_yearMonth_key" ON "FinBalanceSnapshot"("spaceId", "accountId", "yearMonth");

-- AddForeignKey
ALTER TABLE "FinAccount" ADD CONSTRAINT "FinAccount_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinLiability" ADD CONSTRAINT "FinLiability_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCategory" ADD CONSTRAINT "FinCategory_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCategory" ADD CONSTRAINT "FinCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FinCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinClassRule" ADD CONSTRAINT "FinClassRule_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinClassRule" ADD CONSTRAINT "FinClassRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinMappingPreset" ADD CONSTRAINT "FinMappingPreset_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinMappingPreset" ADD CONSTRAINT "FinMappingPreset_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "FinAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinImport" ADD CONSTRAINT "FinImport_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinImport" ADD CONSTRAINT "FinImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinStagedRow" ADD CONSTRAINT "FinStagedRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "FinImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinStagedRow" ADD CONSTRAINT "FinStagedRow_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinStagedRow" ADD CONSTRAINT "FinStagedRow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinStagedRow" ADD CONSTRAINT "FinStagedRow_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "FinImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinBalanceSnapshot" ADD CONSTRAINT "FinBalanceSnapshot_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinBalanceSnapshot" ADD CONSTRAINT "FinBalanceSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


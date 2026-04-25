-- CreateTable: PricingScenario
CREATE TABLE "PricingScenario" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "name" TEXT NOT NULL,
    "memo" TEXT,
    "includeVat" BOOLEAN NOT NULL DEFAULT true,
    "vatRate" DECIMAL(6,4) NOT NULL DEFAULT 0.1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PricingScenarioItem
CREATE TABLE "PricingScenarioItem" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "costPrice" DECIMAL(18,2),
    "salePrice" DECIMAL(18,2) NOT NULL,
    "discountRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "channelFeePct" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "packagingCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adCostPct" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "operatingCostPct" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "finalPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "revenueExVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netProfit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "margin" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PricingScenarioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingScenario_spaceId_updatedAt_idx" ON "PricingScenario"("spaceId", "updatedAt");
CREATE INDEX "PricingScenario_channelId_idx" ON "PricingScenario"("channelId");

CREATE UNIQUE INDEX "PricingScenarioItem_scenarioId_optionId_key" ON "PricingScenarioItem"("scenarioId", "optionId");
CREATE INDEX "PricingScenarioItem_scenarioId_idx" ON "PricingScenarioItem"("scenarioId");
CREATE INDEX "PricingScenarioItem_optionId_idx" ON "PricingScenarioItem"("optionId");

-- AddForeignKey
ALTER TABLE "PricingScenario" ADD CONSTRAINT "PricingScenario_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingScenario" ADD CONSTRAINT "PricingScenario_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PricingScenarioItem" ADD CONSTRAINT "PricingScenarioItem_scenarioId_fkey"
  FOREIGN KEY ("scenarioId") REFERENCES "PricingScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingScenarioItem" ADD CONSTRAINT "PricingScenarioItem_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

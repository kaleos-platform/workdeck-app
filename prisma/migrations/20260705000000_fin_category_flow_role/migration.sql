-- 손익 흐름도(현금흐름 Sankey) 역할 enum + FinCategory.flowRole 컬럼
CREATE TYPE "FinFlowRole" AS ENUM ('MERCH_SALES', 'COGS', 'OPEX', 'FINANCING_COST');

ALTER TABLE "FinCategory" ADD COLUMN "flowRole" "FinFlowRole";

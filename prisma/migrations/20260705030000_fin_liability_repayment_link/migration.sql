-- 부채(FinLiability)에 상환 거래를 귀속하고, 반영 워터마크를 추가한다.

-- AlterTable: 잔액에 이미 반영된 상환 시점 워터마크(이후 상환은 "감지" 대상)
ALTER TABLE "FinLiability" ADD COLUMN "balanceAsOf" TIMESTAMP(3);

-- AlterTable: 거래를 상환으로 특정 부채에 귀속
ALTER TABLE "FinTransaction" ADD COLUMN "liabilityId" TEXT;

-- CreateIndex
CREATE INDEX "FinTransaction_liabilityId_idx" ON "FinTransaction"("liabilityId");

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_liabilityId_fkey" FOREIGN KEY ("liabilityId") REFERENCES "FinLiability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

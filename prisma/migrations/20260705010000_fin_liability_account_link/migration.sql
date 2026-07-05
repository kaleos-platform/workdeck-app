-- AlterTable: 부채에 대출 계좌(FinAccount) 연결용 nullable FK 추가
ALTER TABLE "FinLiability" ADD COLUMN "accountId" TEXT;

-- CreateIndex
CREATE INDEX "FinLiability_accountId_idx" ON "FinLiability"("accountId");

-- AddForeignKey: 계좌 삭제 시 링크만 해제(SetNull), 부채는 유지
ALTER TABLE "FinLiability" ADD CONSTRAINT "FinLiability_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

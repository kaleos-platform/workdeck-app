/**
 * 재무 운영 계정 차트 리셋 (개발/preview 전용)
 *
 * K-IFRS 표준 차트 → 소규모 브랜드 운영 차트로 전환할 때, 대상 space의 분류 데이터를
 * 초기화하고 새 운영 차트를 재시드한다. 확정 거래의 "분류"는 모두 해제되지만(현금주의 거래
 * 자체는 보존), prod 에서는 실행 금지 — 사용자 분류 결과가 사라진다.
 *
 * 실행:
 *   npx tsx scripts/finance-reset-chart.ts <spaceId>
 *   npx tsx scripts/finance-reset-chart.ts <spaceId> --dry-run   # 변경 없이 현황만
 *   FIN_RESET_SPACE_ID=<spaceId> npx tsx scripts/finance-reset-chart.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local', override: false })

import { prisma } from '@/lib/prisma'
import { seedFinanceCategories } from '@/lib/finance/kifrs-seed'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const spaceId = args.find((a) => !a.startsWith('--')) ?? process.env.FIN_RESET_SPACE_ID

  if (!spaceId) {
    console.error('사용법: npx tsx scripts/finance-reset-chart.ts <spaceId> [--dry-run]')
    process.exit(1)
  }

  const [catCount, ruleCount, txnCount, stagedCount] = await Promise.all([
    prisma.finCategory.count({ where: { spaceId } }),
    prisma.finClassRule.count({ where: { spaceId } }),
    prisma.finTransaction.count({ where: { spaceId } }),
    prisma.finStagedRow.count({ where: { spaceId } }),
  ])
  console.log(
    `[reset] space=${spaceId}\n  계정과목 ${catCount} · 규칙 ${ruleCount} · 확정거래 ${txnCount} · 스테이징 ${stagedCount}`
  )

  if (dryRun) {
    console.log('[reset] --dry-run: 변경 없이 종료')
    return
  }

  await prisma.$transaction([
    // 확정/스테이징 거래의 분류 해제(거래 자체는 보존)
    prisma.finTransaction.updateMany({
      where: { spaceId },
      data: {
        categoryId: null,
        classStatus: 'UNCLASSIFIED',
        matchedRuleId: null,
        isTransfer: false,
      },
    }),
    prisma.finStagedRow.updateMany({
      where: { spaceId },
      data: { categoryId: null, classStatus: 'UNCLASSIFIED', matchedRuleId: null },
    }),
    // 학습 규칙·계정과목 삭제(카테고리 삭제가 규칙을 cascade하지만 명시적으로 먼저 비운다)
    prisma.finClassRule.deleteMany({ where: { spaceId } }),
    prisma.finCategory.deleteMany({ where: { spaceId } }),
  ])

  await seedFinanceCategories(spaceId)
  const after = await prisma.finCategory.count({ where: { spaceId } })
  console.log(`[reset] 새 운영 차트 ${after}개 시드 완료`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())

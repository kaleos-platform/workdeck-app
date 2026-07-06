// 발주 계획 번호 생성 — Space 단위 일자별 순번 (yyyyMMdd-NNN).
// plan POST / revert 에서 공유.

import { prisma } from '@/lib/prisma'
import { getTodayStrKst } from '@/lib/date-range'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** 발주 계획 번호 — Space 단위 당일(KST) 생성 건수 + 1 */
export async function generatePlanNo(spaceId: string, tx: Tx): Promise<string> {
  // KST 기준 오늘 자정 인스턴트
  const todayStr = getTodayStrKst()
  const todayStart = new Date(todayStr + 'T00:00:00+09:00')
  const count = await tx.reorderPlan.count({
    where: { spaceId, createdAt: { gte: todayStart } },
  })
  // 번호 접두 = KST 날짜 (yyyyMMdd)
  const prefix = todayStr.replace(/-/g, '')
  return `${prefix}-${String(count + 1).padStart(3, '0')}`
}

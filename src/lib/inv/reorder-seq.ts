// 발주 계획/생산차수 번호 생성 — Space 단위 일자별 순번 (yyyyMMdd-NNN).
// plan POST / revert / generate-run 에서 공유.

import { prisma } from '@/lib/prisma'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

function todayStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function dateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** 발주 계획 번호 — Space 단위 당일 생성 건수 + 1 */
export async function generatePlanNo(spaceId: string, tx: Tx): Promise<string> {
  const today = todayStart()
  const count = await tx.reorderPlan.count({
    where: { spaceId, createdAt: { gte: today } },
  })
  return `${dateStr(today)}-${String(count + 1).padStart(3, '0')}`
}

/** 생산차수 번호 — Space 단위 당일 생성 건수 + offset + 1 (같은 tx 내 다건 생성 대비) */
export async function generateRunNo(spaceId: string, tx: Tx, offset = 0): Promise<string> {
  const today = todayStart()
  const count = await tx.productionRun.count({
    where: { spaceId, createdAt: { gte: today } },
  })
  return `${dateStr(today)}-${String(count + offset + 1).padStart(3, '0')}`
}

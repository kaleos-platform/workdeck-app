/**
 * GET /api/finance/coverage?months=12[&accountId=...]
 * 계좌/카드별 × 월별 데이터 등록 커버리지.
 * - confirmed: 확정 거래(FinTransaction) 건수 — 있으면 "등록됨"
 * - staged: 미확정(DRAFT 임포트) 스테이징 행 건수 — confirmed 없이 있으면 "검토중"
 * txnDate는 KST 자릿수의 UTC 저장 규약 — timezone 변환 없이 저장값 그대로 월을 추출한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type MonthCountRow = { accountId: string; month: string; cnt: number }

const MAX_MONTHS = 36

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { searchParams } = new URL(req.url)
  const monthsParam = Number(searchParams.get('months') ?? 12)
  if (!Number.isInteger(monthsParam) || monthsParam < 1 || monthsParam > MAX_MONTHS) {
    return errorResponse(`months는 1~${MAX_MONTHS} 사이 정수여야 합니다`, 400)
  }
  const accountIdFilter = searchParams.get('accountId')

  // 월 목록(과거 → 현재) — txnDate 규약과 동일하게 UTC 필드로 계산
  const now = new Date()
  const anchor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const months: string[] = []
  for (let i = monthsParam - 1; i >= 0; i--) {
    const d = new Date(anchor)
    d.setUTCMonth(d.getUTCMonth() - i)
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const lowerBound = new Date(anchor)
  lowerBound.setUTCMonth(lowerBound.getUTCMonth() - (monthsParam - 1))

  const [accounts, confirmedRows, stagedRows, lastImports] = await Promise.all([
    prisma.finAccount.findMany({
      where: { spaceId, ...(accountIdFilter ? { id: accountIdFilter } : {}) },
      select: { id: true, name: true, kind: true, institution: true, accountNumber: true },
      orderBy: { createdAt: 'asc' },
    }),
    // 확정 거래 — 계좌 × 월(YYYY-MM, 저장값 그대로) 집계
    prisma.$queryRaw<MonthCountRow[]>`
      SELECT "accountId", to_char("txnDate", 'YYYY-MM') AS month, count(*)::int AS cnt
      FROM "FinTransaction"
      WHERE "spaceId" = ${spaceId} AND "txnDate" >= ${lowerBound}
      GROUP BY 1, 2
    `,
    // 검토중 — DRAFT 임포트의 스테이징 행 집계
    prisma.$queryRaw<MonthCountRow[]>`
      SELECT s."accountId", to_char(s."txnDate", 'YYYY-MM') AS month, count(*)::int AS cnt
      FROM "FinStagedRow" s
      JOIN "FinImport" i ON i.id = s."importId"
      WHERE s."spaceId" = ${spaceId} AND i.status = 'DRAFT' AND s."txnDate" >= ${lowerBound}
      GROUP BY 1, 2
    `,
    prisma.finImport.groupBy({
      by: ['accountId'],
      where: { spaceId },
      _max: { createdAt: true },
    }),
  ])

  const lastImportByAccount = new Map(
    lastImports.map((r) => [r.accountId, r._max.createdAt?.toISOString() ?? null])
  )

  const monthSet = new Set(months)
  const cellsByAccount = new Map<string, Record<string, { confirmed: number; staged: number }>>()
  const cellOf = (accountId: string, month: string) => {
    const cells = cellsByAccount.get(accountId) ?? {}
    cellsByAccount.set(accountId, cells)
    return (cells[month] ??= { confirmed: 0, staged: 0 })
  }
  for (const row of confirmedRows) {
    if (monthSet.has(row.month)) cellOf(row.accountId, row.month).confirmed = row.cnt
  }
  for (const row of stagedRows) {
    if (monthSet.has(row.month)) cellOf(row.accountId, row.month).staged = row.cnt
  }

  return NextResponse.json({
    months,
    accounts: accounts.map((a) => ({
      ...a,
      lastImportAt: lastImportByAccount.get(a.id) ?? null,
      cells: cellsByAccount.get(a.id) ?? {},
    })),
  })
}

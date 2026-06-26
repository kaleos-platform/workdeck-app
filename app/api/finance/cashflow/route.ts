/**
 * GET /api/finance/cashflow
 * 현금흐름 상세(테이블 우선) — 기간 컬럼별 수입/지출을 계정과목 또는 사용자 하위계정 단위로 집계.
 * 수입 섹션 / 지출 섹션 / 순현금흐름 + 직전 기간 대비 증감%.
 *
 * query: grain?(month|quarter|year, 기본 month), from?(YYYY-MM), to?(YYYY-MM),
 *        groupBy?(category|subaccount, 기본 category)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'
import { toNum, round2 } from '@/lib/finance/serialize'
import { ymOf, addMonths, monthList, rangeBounds, signedAmount } from '@/lib/finance/aggregate'

type Grain = 'month' | 'quarter' | 'year'

/** ym("YYYY-MM") → 버킷 키(grain별). */
function bucketOf(ym: string, grain: Grain): string {
  const [y, m] = ym.split('-').map(Number)
  if (grain === 'year') return `${y}`
  if (grain === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
  return ym
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  // 콜드케이스(활성인데 계정과목 0) 자가복구
  await ensureFinanceSeeded(spaceId)

  const sp = req.nextUrl.searchParams
  const grain: Grain =
    sp.get('grain') === 'quarter' ? 'quarter' : sp.get('grain') === 'year' ? 'year' : 'month'
  const groupBy = sp.get('groupBy') === 'subaccount' ? 'subaccount' : 'category'

  const nowYm = ymOf(new Date())
  const defaultFrom =
    grain === 'year'
      ? `${Number(nowYm.slice(0, 4)) - 2}-01`
      : addMonths(nowYm, grain === 'quarter' ? -11 : -5)
  const from = /^\d{4}-\d{2}$/.test(sp.get('from') ?? '') ? sp.get('from')! : defaultFrom
  const to = /^\d{4}-\d{2}$/.test(sp.get('to') ?? '') ? sp.get('to')! : nowYm

  const months = monthList(from <= to ? from : to, from <= to ? to : from)
  // 순서 보존 버킷 목록
  const buckets: string[] = []
  for (const m of months) {
    const b = bucketOf(m, grain)
    if (!buckets.includes(b)) buckets.push(b)
  }

  const { gte, lt } = rangeBounds(months[0], months[months.length - 1])

  const [txns, categories] = await Promise.all([
    prisma.finTransaction.findMany({
      where: { spaceId, txnDate: { gte, lt } },
      select: {
        txnDate: true,
        direction: true,
        amount: true,
        isTransfer: true,
        cancelFlag: true,
        categoryId: true,
      },
    }),
    prisma.finCategory.findMany({
      where: { spaceId },
      select: { id: true, name: true, type: true, parentId: true, groupLabel: true },
    }),
  ])

  const catById = new Map(categories.map((c) => [c.id, c]))
  const rootIds = new Set(categories.filter((c) => c.parentId === null).map((c) => c.id))

  /** 카테고리의 level-1 조상(루트의 직계 자식)을 반환. */
  function levelOne(
    catId: string
  ): { id: string; name: string; type: string; groupLabel: string | null } | null {
    let cur = catById.get(catId)
    if (!cur) return null
    let parentId = cur.parentId
    while (parentId && !rootIds.has(parentId)) {
      const next = catById.get(parentId)
      if (!next) break
      cur = next
      parentId = cur.parentId
    }
    return { id: cur.id, name: cur.name, type: cur.type, groupLabel: cur.groupLabel }
  }

  type Row = {
    key: string
    name: string
    type: 'INCOME' | 'EXPENSE'
    groupLabel: string | null
    values: Record<string, number>
  }
  const rowMap = new Map<string, Row>()

  const ensureRow = (
    key: string,
    name: string,
    type: 'INCOME' | 'EXPENSE',
    groupLabel: string | null
  ) => {
    let r = rowMap.get(key)
    if (!r) {
      r = { key, name, type, groupLabel, values: Object.fromEntries(buckets.map((b) => [b, 0])) }
      rowMap.set(key, r)
    }
    return r
  }

  for (const t of txns) {
    if (t.isTransfer) continue
    const bucket = bucketOf(ymOf(t.txnDate), grain)
    const amt = signedAmount({ amount: toNum(t.amount), cancelFlag: t.cancelFlag })

    // 섹션은 현금 방향(IN=수입 / OUT=지출) 기준 — 대시보드 집계와 동일.
    // 계정과목은 행 라벨로만 쓰고, 방향이 계정과목 type과 어긋나는(오분류) 경우에도
    // 두 화면이 같은 수입/지출 총액을 내도록 한다. key에 섹션을 접두해 동일 계정과목이
    // IN·OUT 둘 다 가질 때 각 섹션에 별도 행으로 분리한다.
    const type: 'INCOME' | 'EXPENSE' = t.direction === 'IN' ? 'INCOME' : 'EXPENSE'
    let key: string
    let name: string
    let groupLabel: string | null = null

    const node = t.categoryId
      ? groupBy === 'subaccount'
        ? catById.get(t.categoryId)
        : levelOne(t.categoryId)
      : null
    if (node) {
      key = `${type}:${node.id}`
      name = node.name
      groupLabel = 'groupLabel' in node ? (node.groupLabel ?? null) : null
    } else {
      key = `__none_${type}`
      name = '미분류'
    }

    const row = ensureRow(key, name, type, groupLabel)
    row.values[bucket] += amt
  }

  const allRows = [...rowMap.values()].map((r) => ({
    ...r,
    values: Object.fromEntries(buckets.map((b) => [b, round2(r.values[b])])),
  }))
  const incomeRows = allRows
    .filter((r) => r.type === 'INCOME')
    .sort((a, b) => sumValues(b) - sumValues(a))
  const expenseRows = allRows
    .filter((r) => r.type === 'EXPENSE')
    .sort((a, b) => sumValues(b) - sumValues(a))

  const bucketTotal = (rows: typeof allRows, b: string) =>
    round2(rows.reduce((acc, r) => acc + r.values[b], 0))
  const incomeTotals = Object.fromEntries(buckets.map((b) => [b, bucketTotal(incomeRows, b)]))
  const expenseTotals = Object.fromEntries(buckets.map((b) => [b, bucketTotal(expenseRows, b)]))
  const netTotals = Object.fromEntries(
    buckets.map((b) => [b, round2(incomeTotals[b] - expenseTotals[b])])
  )

  // 마지막 vs 직전 버킷 증감%
  const changePct = (vals: Record<string, number>): number | null => {
    if (buckets.length < 2) return null
    const last = vals[buckets[buckets.length - 1]]
    const prev = vals[buckets[buckets.length - 2]]
    if (prev === 0) return null
    return round2(((last - prev) / Math.abs(prev)) * 100)
  }

  return NextResponse.json({
    grain,
    groupBy,
    from,
    to,
    buckets,
    incomeRows: incomeRows.map((r) => ({ ...r, changePct: changePct(r.values) })),
    expenseRows: expenseRows.map((r) => ({ ...r, changePct: changePct(r.values) })),
    totals: {
      income: { values: incomeTotals, changePct: changePct(incomeTotals) },
      expense: { values: expenseTotals, changePct: changePct(expenseTotals) },
      net: { values: netTotals, changePct: changePct(netTotals) },
    },
  })
}

function sumValues(r: { values: Record<string, number> }): number {
  return Object.values(r.values).reduce((a, b) => a + b, 0)
}

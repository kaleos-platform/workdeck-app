/**
 * 재무 관리 Deck — 조회(read) 로직 단일 소스.
 * app/api/finance/* route와 MCP tool이 동일한 함수를 공유하기 위해
 * 각 route의 인라인 쿼리/집계 로직을 기계적으로 이동한 것.
 *
 * ⚠️ 규약:
 *  - 이 파일의 함수는 순수 read다(mutate 금지). ensureFinanceSeeded는 여기에 없다(route에 남김).
 *  - URLSearchParams·NextRequest·NextResponse를 다루지 않는다.
 *    파라미터는 이미 파싱된 타입 인자로 받고, route가 NextResponse.json에 넘기던 바로 그 객체를 반환한다.
 */
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull, round2 } from '@/lib/finance/serialize'
import {
  ymOf,
  nowYmKst,
  addMonths,
  monthList,
  rangeBounds,
  signedAmount,
  aggregateByMonth,
  aggregateExpenseByCategory,
  type AggRow,
} from '@/lib/finance/aggregate'
import {
  bucketOf,
  bucketMonthRange,
  defaultSelectedPeriods,
  normalizeSelectedPeriods,
  type Grain,
} from '@/lib/finance/periods'
import { computeLiabilityPending } from '@/lib/finance/liability'
import { computePnlMetrics, type PnlTxnFact } from '@/lib/finance/pnl-metrics'
import type { Prisma } from '@/generated/prisma/client'
import type { FinFlowRole } from '@/generated/prisma/enums'

// ────────────────────────────────────────────────────────────────────────────
// transactions
// ────────────────────────────────────────────────────────────────────────────

/** 컬럼명 정렬 파라미터 → Prisma orderBy(비-일자 컬럼엔 txnDate desc 타이브레이크). */
function buildOrderBy(
  sort: string | null,
  order: 'asc' | 'desc'
): Prisma.FinTransactionOrderByWithRelationInput[] {
  const tie: Prisma.FinTransactionOrderByWithRelationInput = { txnDate: 'desc' }
  switch (sort) {
    case 'amount':
      return [{ amount: order }, tie]
    case 'balanceAfter':
      return [{ balanceAfter: order }, tie]
    case 'account':
      return [{ account: { name: order } }, tie]
    case 'category':
      return [{ category: { name: order } }, tie]
    case 'classStatus':
      return [{ classStatus: order }, tie]
    case 'description':
      return [{ description: order }, tie]
    default:
      return [{ txnDate: order }]
  }
}

export interface QueryTransactionsOptions {
  accountId?: string | null
  from?: string | null
  to?: string | null
  direction?: string | null
  classStatus?: string | null
  categoryIds?: string[]
  uncategorized?: boolean
  categoryId?: string | null
  /**
   * categoryId를 대분류로 해석해 자손 리프까지 확장(서브트리 매칭). 거래내역 필터 딥링크 전용.
   * 미설정(기본)이면 정확 일치 — 기존 caller(다른 route·MCP tool) 하위호환 보존.
   */
  expandCategory?: boolean
  excludeTransfer?: boolean
  q?: string | null
  take: number
  skip: number
  sort?: string | null
  order: 'asc' | 'desc'
}

/**
 * space 내 categoryId의 self + 재귀 자손 id 집합.
 * 재무 트리는 대분류→리프 1단계지만 깊어져도 안전하도록 BFS. 카테고리 수가 적어 1쿼리로 로드.
 */
async function collectSelfAndDescendants(spaceId: string, rootId: string): Promise<string[]> {
  const cats = await prisma.finCategory.findMany({
    where: { spaceId },
    select: { id: true, parentId: true },
  })
  const childrenOf = new Map<string, string[]>()
  for (const c of cats) {
    if (!c.parentId) continue
    const arr = childrenOf.get(c.parentId)
    if (arr) arr.push(c.id)
    else childrenOf.set(c.parentId, [c.id])
  }
  const out: string[] = []
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    const kids = childrenOf.get(id)
    if (kids) stack.push(...kids)
  }
  return out
}

export async function queryTransactions(spaceId: string, opts: QueryTransactionsOptions) {
  const take = opts.take
  const skip = opts.skip

  const from = opts.from ?? null
  const to = opts.to ?? null
  const direction = opts.direction ?? null
  const classStatus = opts.classStatus ?? null
  const q = opts.q?.trim()
  const order: 'asc' | 'desc' = opts.order
  const orderBy = buildOrderBy(opts.sort ?? null, order)

  // 계정과목 필터(현금흐름 상세 → 행 클릭):
  //  - categoryIds: 콤마 구분 다중(대분류 클릭 시 그 하위 리프 id들). 정확 일치 in.
  //  - uncategorized=1: 미분류(categoryId null).
  //  - 둘 다 있으면(leaf 모드 서브그룹에 미분류 리프 혼합) OR로 결합.
  //  - categoryId(단일, 정확): 기존 전체 거래 탭 하위호환.
  const categoryIds = opts.categoryIds ?? []
  const wantUncat = opts.uncategorized === true
  const singleCat = opts.categoryId ?? null

  const where: Prisma.FinTransactionWhereInput = {
    spaceId,
    ...(opts.accountId ? { accountId: opts.accountId } : {}),
    ...(direction === 'IN' || direction === 'OUT' ? { direction } : {}),
    ...(opts.excludeTransfer === true ? { isTransfer: false } : {}),
    ...(classStatus === 'CLASSIFIED' || classStatus === 'REVIEW' || classStatus === 'UNCLASSIFIED'
      ? { classStatus }
      : {}),
    ...(from || to
      ? {
          txnDate: {
            // 로컬 자정 경계 — 대시보드/집계(aggregate.ts)의 로컬 월 경계와 시간대 일치
            ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
          },
        }
      : {}),
  }

  // 계정과목 조건 구성.
  if (categoryIds.length && wantUncat) {
    where.OR = [{ categoryId: { in: categoryIds } }, { categoryId: null }]
  } else if (categoryIds.length) {
    where.categoryId = { in: categoryIds }
  } else if (wantUncat) {
    where.categoryId = null
  } else if (singleCat) {
    if (opts.expandCategory) {
      // 대분류 선택 시 자손 리프까지. 리프 단건이면 자손 없어 in [self] = 정확 일치(하위호환).
      const ids = await collectSelfAndDescendants(spaceId, singleCat)
      where.categoryId = { in: ids }
    } else {
      where.categoryId = singleCat
    }
  }

  // 적요/가맹점 검색 — 위 계정과목 OR와 키 충돌 방지 위해 OR 병존 시 AND로 감쌈.
  if (q) {
    const qOr: Prisma.FinTransactionWhereInput[] = [
      { description: { contains: q, mode: 'insensitive' } },
      { counterparty: { contains: q, mode: 'insensitive' } },
    ]
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: qOr }]
      delete where.OR
    } else {
      where.OR = qOr
    }
  }

  // 요약 집계(incomeTotal/expenseTotal)는 이체를 제외한다 — 대시보드·현금흐름과 정의 일치.
  // 행 목록(where)은 변경 없이 이체 행을 계속 표시하며, excludeTransfer=1 파라미터로 별도 제어.
  const sumWhere = { ...where, isTransfer: false }

  const [rows, total, sums] = await Promise.all([
    prisma.finTransaction.findMany({
      where,
      orderBy,
      take,
      skip,
      select: {
        id: true,
        accountId: true,
        txnDate: true,
        direction: true,
        amount: true,
        balanceAfter: true,
        description: true,
        counterparty: true,
        memo: true,
        approvalNo: true,
        cancelFlag: true,
        isTransfer: true,
        classStatus: true,
        matchedRuleId: true,
        categoryId: true,
        liabilityId: true,
        category: {
          select: { id: true, name: true, type: true, parent: { select: { name: true } } },
        },
        liability: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, kind: true } },
      },
    }),
    prisma.finTransaction.count({ where }),
    prisma.finTransaction.groupBy({
      by: ['direction'],
      where: sumWhere,
      _sum: { amount: true },
    }),
  ])

  const incomeTotal = toNum(sums.find((s) => s.direction === 'IN')?._sum.amount)
  const expenseTotal = toNum(sums.find((s) => s.direction === 'OUT')?._sum.amount)

  return {
    rows: rows.map((r) => ({
      ...r,
      amount: toNum(r.amount),
      balanceAfter: toNumOrNull(r.balanceAfter),
    })),
    total,
    summary: { incomeTotal, expenseTotal, net: incomeTotal - expenseTotal },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// cashflow
// ────────────────────────────────────────────────────────────────────────────

export interface QueryCashflowOptions {
  grain: Grain
  periods?: string[]
  /** 계산에서 제외할 계정과목(리프) id — 표·손익 지표 모두에서 빠진다. */
  exclude?: string[]
}

export async function queryCashflow(spaceId: string, opts: QueryCashflowOptions) {
  const grain: Grain = opts.grain

  const nowYm = nowYmKst()
  // 표시 버킷 = periods 파라미터(검증·정렬·캡) 또는 기본값(직전월까지 최근 N). 항상 오름차순.
  const requested = opts.periods ?? []
  const buckets = normalizeSelectedPeriods(requested, grain) ?? defaultSelectedPeriods(grain, nowYm)
  const bucketSet = new Set(buckets)

  // 조회 월 범위 = 선택 버킷들이 포함하는 최소~최대 월.
  const monthEdges = buckets.map((b) => bucketMonthRange(b, grain))
  const fromYm = monthEdges.reduce((a, e) => (e.firstYm < a ? e.firstYm : a), monthEdges[0].firstYm)
  const toYm = monthEdges.reduce((a, e) => (e.lastYm > a ? e.lastYm : a), monthEdges[0].lastYm)
  const { gte, lt } = rangeBounds(fromYm, toYm)

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
      select: {
        id: true,
        name: true,
        type: true,
        parentId: true,
        groupLabel: true,
        flowRole: true,
      },
    }),
  ])

  const excludeSet = new Set(opts.exclude ?? [])
  const catById = new Map(categories.map((c) => [c.id, c]))
  const rootIds = new Set(categories.filter((c) => c.parentId === null).map((c) => c.id))
  const parentIds = new Set(categories.map((c) => c.parentId).filter((p): p is string => !!p))

  /** 카테고리의 level-1 조상(루트의 직계 자식) — 상위 대분류. flowRole 포함. */
  function levelOne(
    catId: string
  ): { id: string; name: string; flowRole: FinFlowRole | null } | null {
    let cur = catById.get(catId)
    if (!cur) return null
    let parentId = cur.parentId
    while (parentId && !rootIds.has(parentId)) {
      const next = catById.get(parentId)
      if (!next) break
      cur = next
      parentId = cur.parentId
    }
    return { id: cur.id, name: cur.name, flowRole: cur.flowRole }
  }

  // 행 = 리프(운영 항목) 단위. 각 행에 상위 대분류(parentId/parentName/flowRole)를 첨부해
  // 프론트가 대분류/계층/하위만 3모드를 파생한다. 미분류는 parentId=null.
  type Row = {
    key: string
    name: string
    type: 'INCOME' | 'EXPENSE'
    groupLabel: string | null
    parentId: string | null
    parentName: string
    flowRole: FinFlowRole | null
    values: Record<string, number>
  }
  const rowMap = new Map<string, Row>()
  // 손익 지표(공헌·매출총·영업이익 등) 집계용 거래 사실. 제외 계정과목·이체는 미포함.
  const pnlFacts: PnlTxnFact[] = []

  // 손익계산서/공헌이익 관점용 — 계정별 자연부호 net(수입계정 IN:+/OUT:−, 지출계정 OUT:+/IN:−).
  // 환불(자연방향 반대 거래)이 계정 내 상계되어 헤더=Σleaf·당기순이익=순현금흐름 불변식 보장.
  type PnlLeaf = {
    id: string
    name: string
    type: 'INCOME' | 'EXPENSE'
    flowRole: FinFlowRole | null
    groupLabel: string | null
    values: Record<string, number>
  }
  const pnlLeafMap = new Map<string, PnlLeaf>()
  const ensurePnlLeaf = (key: string, seed: Omit<PnlLeaf, 'values'>) => {
    let l = pnlLeafMap.get(key)
    if (!l) {
      l = { ...seed, values: Object.fromEntries(buckets.map((b) => [b, 0])) }
      pnlLeafMap.set(key, l)
    }
    return l
  }

  const ensureRow = (key: string, seed: Omit<Row, 'values'>) => {
    let r = rowMap.get(key)
    if (!r) {
      r = { ...seed, values: Object.fromEntries(buckets.map((b) => [b, 0])) }
      rowMap.set(key, r)
    }
    return r
  }

  for (const t of txns) {
    if (t.isTransfer) continue
    // 제외 계정과목: 표·지표 모두에서 완전히 빠진다.
    if (t.categoryId && excludeSet.has(t.categoryId)) continue
    const bucket = bucketOf(ymOf(t.txnDate), grain)
    // 비연속 선택 시 갭 기간(예: 1·5월만 선택했는데 3월 거래)은 미시드 버킷 → 건너뜀(NaN 방지).
    if (!bucketSet.has(bucket)) continue
    const amt = signedAmount({ amount: toNum(t.amount), cancelFlag: t.cancelFlag })

    // 섹션은 현금 방향(IN=수입 / OUT=지출) 기준 — 대시보드 집계와 동일.
    // 계정과목은 행 라벨로만 쓰고, 방향이 계정과목 type과 어긋나는(오분류) 경우에도
    // 두 화면이 같은 수입/지출 총액을 내도록 한다. key에 섹션을 접두해 동일 계정과목이
    // IN·OUT 둘 다 가질 때 각 섹션에 별도 행으로 분리한다.
    const type: 'INCOME' | 'EXPENSE' = t.direction === 'IN' ? 'INCOME' : 'EXPENSE'

    // 리프(운영 항목) 그대로를 행으로, 상위 대분류(levelOne)를 메타로 첨부.
    const leaf = t.categoryId ? catById.get(t.categoryId) : null
    const parent = t.categoryId ? levelOne(t.categoryId) : null

    let key: string
    let seed: Omit<Row, 'values'>
    if (leaf) {
      key = `${type}:${leaf.id}`
      seed = {
        key,
        name: leaf.name,
        type,
        groupLabel: leaf.groupLabel ?? null,
        parentId: parent?.id ?? leaf.id,
        parentName: parent?.name ?? leaf.name,
        flowRole: parent?.flowRole ?? null,
      }
    } else {
      key = `__none_${type}`
      seed = {
        key,
        name: '미분류',
        type,
        groupLabel: null,
        parentId: null,
        parentName: '미분류',
        flowRole: null,
      }
    }

    const row = ensureRow(key, seed)
    row.values[bucket] += amt

    // 손익 지표: 대분류 flowRole + 리프 groupLabel로 사실 축적.
    pnlFacts.push({
      bucket,
      direction: t.direction,
      amount: amt,
      flowRole: parent?.flowRole ?? null,
      groupLabel: leaf?.groupLabel ?? null,
    })

    // 손익계산서/공헌이익용 계정별 자연부호 net. 계정 type이 자연방향(미분류는 거래방향 폴백).
    const natType: 'INCOME' | 'EXPENSE' =
      leaf?.type === 'INCOME' || leaf?.type === 'EXPENSE'
        ? leaf.type
        : t.direction === 'IN'
          ? 'INCOME'
          : 'EXPENSE'
    const natSign =
      natType === 'INCOME'
        ? t.direction === 'IN'
          ? amt
          : -amt
        : t.direction === 'OUT'
          ? amt
          : -amt
    const pKey = leaf?.id ?? `__none_${natType}`
    const pLeaf = ensurePnlLeaf(pKey, {
      id: pKey,
      name: leaf?.name ?? '미분류',
      type: natType,
      flowRole: parent?.flowRole ?? null,
      groupLabel: leaf?.groupLabel ?? null,
    })
    pLeaf.values[bucket] += natSign
  }

  const metrics = computePnlMetrics(pnlFacts, buckets)

  // 제외 필터 UI용 리프(운영 항목) 카탈로그 — 제외/거래 유무와 무관하게 전량 제공.
  const leafOptions = categories
    .filter((c) => !parentIds.has(c.id) && !rootIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentName: c.parentId ? (catById.get(c.parentId)?.name ?? null) : null,
    }))

  const pnlLeaves = [...pnlLeafMap.values()].map((l) => ({
    ...l,
    values: Object.fromEntries(buckets.map((b) => [b, round2(l.values[b])])),
  }))

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

  return {
    grain,
    from: fromYm,
    to: toYm,
    buckets,
    incomeRows: incomeRows.map((r) => ({ ...r, changePct: changePct(r.values) })),
    expenseRows: expenseRows.map((r) => ({ ...r, changePct: changePct(r.values) })),
    totals: {
      income: { values: incomeTotals, changePct: changePct(incomeTotals) },
      expense: { values: expenseTotals, changePct: changePct(expenseTotals) },
      net: { values: netTotals, changePct: changePct(netTotals) },
    },
    metrics,
    pnlLeaves,
    leafOptions,
    exclude: [...excludeSet],
  }
}

function sumValues(r: { values: Record<string, number> }): number {
  return Object.values(r.values).reduce((a, b) => a + b, 0)
}

// ────────────────────────────────────────────────────────────────────────────
// accounts
// ────────────────────────────────────────────────────────────────────────────

export async function queryAccounts(spaceId: string) {
  const accounts = await prisma.finAccount.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
  })

  return {
    accounts: accounts.map((a) => ({
      ...a,
      openingBalance: toNumOrNull(a.openingBalance),
      currentBalance: toNumOrNull(a.currentBalance),
    })),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// dashboard
// ────────────────────────────────────────────────────────────────────────────

export interface QueryDashboardOptions {
  period: 'month' | 'quarter' | 'year'
  anchor?: string | null
}

export async function queryDashboard(spaceId: string, opts: QueryDashboardOptions) {
  const period = opts.period
  const now = new Date()
  const nowYm = nowYmKst()

  // ── 기간 산정 ──
  let curMonths: string[]
  let prevMonths: string[]
  let trendMonths: string[]
  let label: string

  if (period === 'year') {
    const rawYear = Number(opts.anchor)
    const Y = Number.isInteger(rawYear) && rawYear > 1900 ? rawYear : now.getFullYear()
    curMonths = monthList(`${Y}-01`, `${Y}-12`)
    prevMonths = monthList(`${Y - 1}-01`, `${Y - 1}-12`)
    trendMonths = curMonths
    label = `${Y}`
  } else if (period === 'quarter') {
    // anchor = YYYY-Qn. 없거나 형식 오류면 현재월(KST) 기준 분기로 폴백.
    const m = /^(\d{4})-Q([1-4])$/.exec(opts.anchor ?? '')
    let Y: number
    let Q: number
    if (m) {
      Y = Number(m[1])
      Q = Number(m[2])
    } else {
      const [ny, nm] = nowYm.split('-').map(Number)
      Y = ny
      Q = Math.floor((nm - 1) / 3) + 1
    }
    const startM = (Q - 1) * 3 + 1
    const qStart = `${Y}-${String(startM).padStart(2, '0')}`
    const qEnd = `${Y}-${String(startM + 2).padStart(2, '0')}`
    curMonths = monthList(qStart, qEnd)
    // 직전 분기(3개월).
    prevMonths = monthList(addMonths(qStart, -3), addMonths(qStart, -1))
    // 최근 12개월 추이(분기말 기준).
    trendMonths = monthList(addMonths(qEnd, -11), qEnd)
    label = `${Y} ${Q}분기`
  } else {
    const anchor = /^\d{4}-\d{2}$/.test(opts.anchor ?? '') ? opts.anchor! : nowYm
    curMonths = [anchor]
    prevMonths = [addMonths(anchor, -1)]
    trendMonths = monthList(addMonths(anchor, -11), anchor)
    label = anchor
  }

  const curEndYm = curMonths[curMonths.length - 1]
  const prevEndYm = prevMonths[prevMonths.length - 1]
  const windowFrom = trendMonths[0] < prevMonths[0] ? prevMonths[0] : trendMonths[0]
  const fetchFrom = prevMonths[0] < windowFrom ? prevMonths[0] : windowFrom
  const { gte, lt } = rangeBounds(
    fetchFrom < trendMonths[0] ? fetchFrom : trendMonths[0],
    curEndYm > trendMonths[trendMonths.length - 1] ? curEndYm : trendMonths[trendMonths.length - 1]
  )

  // ── 데이터 로드 ──
  const [txns, accounts, snapshots, liabilities, repaymentTxns] = await Promise.all([
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
    prisma.finAccount.findMany({
      where: { spaceId },
      select: {
        id: true,
        name: true,
        kind: true,
        institution: true,
        accountNumber: true,
        openingBalance: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.finBalanceSnapshot.findMany({
      where: { spaceId },
      select: { accountId: true, yearMonth: true, balance: true },
      orderBy: { yearMonth: 'asc' },
    }),
    prisma.finLiability.findMany({
      where: { spaceId },
      select: {
        id: true,
        name: true,
        lender: true,
        principal: true,
        balance: true,
        rate: true,
        dueDate: true,
        monthlyPayment: true,
        memo: true,
        accountId: true,
        balanceAsOf: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    // 부채에 연결된 상환 거래(감지용) — 링크된 것만이라 경량.
    prisma.finTransaction.findMany({
      where: { spaceId, liabilityId: { not: null } },
      select: { liabilityId: true, amount: true, txnDate: true, direction: true },
    }),
  ])

  const rows: AggRow[] = txns.map((t) => ({
    txnDate: t.txnDate,
    direction: t.direction,
    amount: toNum(t.amount),
    isTransfer: t.isTransfer,
    cancelFlag: t.cancelFlag,
    categoryId: t.categoryId,
  }))
  const monthAgg = aggregateByMonth(rows)

  const sumMonths = (months: string[], key: 'income' | 'expense') =>
    round2(months.reduce((acc, m) => acc + (monthAgg.get(m)?.[key] ?? 0), 0))

  const income = sumMonths(curMonths, 'income')
  const expense = sumMonths(curMonths, 'expense')
  const prevIncome = sumMonths(prevMonths, 'income')
  const prevExpense = sumMonths(prevMonths, 'expense')

  // ── 잔고 스냅샷 (carry-forward) ──
  const snapByAccount = new Map<string, { ym: string; balance: number }[]>()
  for (const s of snapshots) {
    const arr = snapByAccount.get(s.accountId) ?? []
    arr.push({ ym: s.yearMonth, balance: toNum(s.balance) })
    snapByAccount.set(s.accountId, arr)
  }
  const balAt = (accountId: string, ym: string): number | null => {
    const list = snapByAccount.get(accountId)
    if (!list) return null
    let val: number | null = null
    for (const s of list) {
      if (s.ym <= ym) val = s.balance
      else break
    }
    return val
  }

  const bankAccounts = accounts.filter((a) => a.kind === 'BANK')
  // 해당 월까지 스냅샷이 없으면(거래 없음/계좌 신규) openingBalance를 잔액으로 사용.
  const cashAt = (ym: string) =>
    round2(
      bankAccounts.reduce(
        (acc, a) => acc + (balAt(a.id, ym) ?? toNumOrNull(a.openingBalance) ?? 0),
        0
      )
    )
  const totalCash = cashAt(curEndYm)
  const prevTotalCash = cashAt(prevEndYm)

  // ── 추이 ──
  const trend = trendMonths.map((m) => {
    const a = monthAgg.get(m) ?? { income: 0, expense: 0 }
    return {
      ym: m,
      income: round2(a.income),
      expense: round2(a.expense),
      net: round2(a.income - a.expense),
    }
  })

  // ── 계정과목별 지출 Top ──
  const curRows = rows.filter((r) => {
    const m = ymOf(r.txnDate)
    return m >= curMonths[0] && m <= curEndYm
  })
  const expenseByCat = aggregateExpenseByCategory(curRows)
  const catIds = [...expenseByCat.keys()].filter((k) => k !== '__none')
  const cats =
    catIds.length > 0
      ? await prisma.finCategory.findMany({
          where: { spaceId, id: { in: catIds } },
          select: { id: true, name: true, groupLabel: true, parent: { select: { name: true } } },
        })
      : []
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const expenseTop = [...expenseByCat.entries()]
    .map(([id, amount]) => ({
      categoryId: id === '__none' ? null : id,
      name: id === '__none' ? '미분류' : (catMap.get(id)?.name ?? '(삭제된 계정)'),
      groupLabel: id === '__none' ? null : (catMap.get(id)?.groupLabel ?? null),
      amount: round2(amount),
    }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)

  // ── 계좌별 잔고 스냅샷 (UI) ──
  const sparkMonths = trendMonths.slice(-6)
  const accountSnapshots = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    institution: a.institution,
    accountNumber: a.accountNumber,
    balance: a.kind === 'BANK' ? balAt(a.id, curEndYm) : null,
    openingBalance: toNumOrNull(a.openingBalance),
    sparkline: a.kind === 'BANK' ? sparkMonths.map((m) => balAt(a.id, m)) : null,
  }))

  // ── 부채 현황 ──
  // 미반영 상환 감지 = 연결된 OUT 거래 중 txnDate > (balanceAsOf ?? createdAt)
  const pendingByLiability = computeLiabilityPending(
    liabilities.map((l) => ({
      id: l.id,
      balanceAsOf: l.balanceAsOf,
      createdAt: l.createdAt,
    })),
    repaymentTxns.map((t) => ({
      liabilityId: t.liabilityId,
      amount: toNum(t.amount),
      txnDate: t.txnDate,
      direction: t.direction,
    }))
  )
  const liabilityList = liabilities.map((l) => {
    const principal = toNum(l.principal)
    const balance = toNum(l.balance)
    const repaymentRate =
      principal > 0 ? Math.min(1, Math.max(0, (principal - balance) / principal)) : 0
    const pending = pendingByLiability.get(l.id) ?? { count: 0, sum: 0, throughDate: null }
    return {
      id: l.id,
      name: l.name,
      lender: l.lender,
      principal,
      balance,
      rate: l.rate,
      dueDate: l.dueDate,
      monthlyPayment: toNumOrNull(l.monthlyPayment),
      memo: l.memo,
      accountId: l.accountId,
      repaymentRate: round2(repaymentRate),
      pending,
    }
  })
  const totalLiability = round2(liabilityList.reduce((acc, l) => acc + l.balance, 0))

  return {
    period,
    label,
    kpi: {
      totalCash,
      prevTotalCash,
      income,
      prevIncome,
      expense,
      prevExpense,
      net: round2(income - expense),
      prevNet: round2(prevIncome - prevExpense),
      netWorth: round2(totalCash - totalLiability),
      totalLiability,
    },
    trend,
    accountSnapshots,
    expenseTop,
    liabilities: liabilityList,
  }
}

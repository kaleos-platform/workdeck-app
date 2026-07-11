/**
 * GET /api/finance/dashboard
 * 요약 대시보드 집계 — KPI(총현금/수입/지출/순현금흐름 + 전기 대비), 12개월 추이,
 * 계좌별 잔고 스냅샷, 계정과목별 지출 Top, 부채 현황.
 *
 * query: period?(month|year, 기본 month), anchor?(month=YYYY-MM, year=YYYY; 기본 현재)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'
import { toNum, toNumOrNull, round2 } from '@/lib/finance/serialize'
import {
  ymOf,
  nowYmKst,
  addMonths,
  monthList,
  rangeBounds,
  aggregateByMonth,
  aggregateExpenseByCategory,
  type AggRow,
} from '@/lib/finance/aggregate'
import { computeLiabilityPending } from '@/lib/finance/liability'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  // 콜드케이스(활성인데 계정과목 0) 자가복구
  await ensureFinanceSeeded(spaceId)

  const sp = req.nextUrl.searchParams
  const period = sp.get('period') === 'year' ? 'year' : 'month'
  const now = new Date()
  const nowYm = nowYmKst()

  // ── 기간 산정 ──
  let curMonths: string[]
  let prevMonths: string[]
  let trendMonths: string[]
  let label: string

  if (period === 'year') {
    const rawYear = Number(sp.get('anchor'))
    const Y = Number.isInteger(rawYear) && rawYear > 1900 ? rawYear : now.getFullYear()
    curMonths = monthList(`${Y}-01`, `${Y}-12`)
    prevMonths = monthList(`${Y - 1}-01`, `${Y - 1}-12`)
    trendMonths = curMonths
    label = `${Y}`
  } else {
    const anchor = /^\d{4}-\d{2}$/.test(sp.get('anchor') ?? '') ? sp.get('anchor')! : nowYm
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

  return NextResponse.json({
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
  })
}

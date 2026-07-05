/**
 * GET /api/finance/cashflow/sankey
 * 현금흐름 상세 "손익 흐름도"(Sankey) — 단일 기간의 손익 워터폴.
 * 총수입 → 상품매출/기타수익 → 매출원가·매출총이익 → 판매관리비·영업이익 → 금융비용·순현금흐름.
 *
 * 손익 계층은 level-1 대분류(FinCategory.flowRole)로 분류한다:
 *  - 수입측: MERCH_SALES=상품매출, 그 외/미태그=기타수익
 *  - 지출측: COGS=매출원가, FINANCING_COST=금융비용, OPEX/미태그=판매관리비
 * 섹션(수입/지출)은 테이블과 동일하게 거래 방향(IN/OUT)이 진실 원본 —
 * 이 덕분에 순현금흐름(terminal) == 테이블 net이 구조적으로 보장된다.
 *
 * 단일 기간: grain(month|quarter|year). 기본은 직전월이 속한 버킷. `period`(버킷키, 예 2026-05/
 *  2026-Q1/2025)로 특정 기간 지정 가능. 유효하지 않으면 기본(직전월)으로 폴백.
 *
 * recharts Sankey는 음수 링크를 못 그리므로, 적자·비정상 기간은 renderable:false로 반환한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'
import { toNum, round2 } from '@/lib/finance/serialize'
import { ymOf, addMonths, rangeBounds, signedAmount } from '@/lib/finance/aggregate'
import { bucketOf, bucketMonthRange, bucketLabel, isValidBucket, type Grain } from '@/lib/finance/periods'
import type { FinFlowRole } from '@/generated/prisma/enums'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  await ensureFinanceSeeded(spaceId)

  const sp = req.nextUrl.searchParams
  const grain: Grain =
    sp.get('grain') === 'quarter' ? 'quarter' : sp.get('grain') === 'year' ? 'year' : 'month'

  // 표시 버킷 = period 파라미터(검증) 또는 기본(직전월이 속한 버킷). 진행 중인 현재월 제외.
  const reqPeriod = sp.get('period') ?? ''
  const defaultBucket = bucketOf(addMonths(ymOf(new Date()), -1), grain)
  const bucket = isValidBucket(reqPeriod, grain) ? reqPeriod : defaultBucket
  const { firstYm, lastYm } = bucketMonthRange(bucket, grain)
  const periodLabel = bucketLabel(bucket, grain)
  const lo = firstYm
  const hi = lastYm

  const { gte, lt } = rangeBounds(lo, hi)

  const [txns, categories] = await Promise.all([
    prisma.finTransaction.findMany({
      where: { spaceId, txnDate: { gte, lt } },
      select: {
        direction: true,
        amount: true,
        isTransfer: true,
        cancelFlag: true,
        categoryId: true,
      },
    }),
    prisma.finCategory.findMany({
      where: { spaceId },
      select: { id: true, name: true, type: true, parentId: true, flowRole: true },
    }),
  ])

  const catById = new Map(categories.map((c) => [c.id, c]))
  const rootIds = new Set(categories.filter((c) => c.parentId === null).map((c) => c.id))

  /** 카테고리의 level-1 조상(루트의 직계 자식)을 반환. flowRole 포함. */
  function levelOne(catId: string): { id: string; name: string; flowRole: FinFlowRole | null } | null {
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

  // ── flowRole별 집계 (거래 방향 우선) ──────────────────────────────────────────
  let merch = 0 // 상품매출
  let cogs = 0 // 매출원가
  let opex = 0 // 판매관리비(영업비용)
  let fin = 0 // 금융비용
  // 기타수익: 대분류 단위로 분해(흐름도 노드). key = 대분류 id(미분류는 '__none').
  const otherIncome = new Map<string, { name: string; value: number }>()

  const addOther = (id: string, name: string, amt: number) => {
    const e = otherIncome.get(id)
    if (e) e.value += amt
    else otherIncome.set(id, { name, value: amt })
  }

  for (const t of txns) {
    if (t.isTransfer) continue
    const amt = signedAmount({ amount: toNum(t.amount), cancelFlag: t.cancelFlag })
    const node = t.categoryId ? levelOne(t.categoryId) : null
    const role = node?.flowRole ?? null

    if (t.direction === 'IN') {
      // 수입측: 상품매출 vs 기타수익
      if (role === 'MERCH_SALES') merch += amt
      else addOther(node?.id ?? '__none', node?.name ?? '기타수익', amt)
    } else {
      // 지출측: 매출원가 / 금융비용 / 판매관리비(그 외·미태그)
      if (role === 'COGS') cogs += amt
      else if (role === 'FINANCING_COST') fin += amt
      else opex += amt
    }
  }

  merch = round2(merch)
  cogs = round2(cogs)
  opex = round2(opex)
  fin = round2(fin)
  // 기타수익 대분류들 — 원본(음수 포함). 총계·net은 반드시 전체 합에서 계산해
  // 테이블 net과 어긋나지 않게 한다(취소/환불로 특정 버킷이 음수일 수 있음).
  const othersRaw = [...otherIncome.values()]
    .map((o) => ({ name: o.name, value: round2(o.value) }))
    .sort((a, b) => b.value - a.value)
  const otherTotal = round2(othersRaw.reduce((a, o) => a + o.value, 0))
  // 노드/링크로 그릴 수 있는 건 양수 버킷뿐.
  const others = othersRaw.filter((o) => o.value > 0)

  const totalIncome = round2(merch + otherTotal)
  const grossProfit = round2(merch - cogs) // 매출총이익 = 상품매출 − 매출원가
  const operatingProfit = round2(grossProfit + otherTotal - opex) // 영업이익
  const net = round2(totalIncome - cogs - opex - fin) // 순현금흐름 (== 테이블 net)

  const totals = {
    totalIncome,
    merchSales: merch,
    otherIncome: otherTotal,
    cogs,
    grossProfit,
    opex,
    operatingProfit,
    financingCost: fin,
    net,
  }

  // ── 렌더 가능성 판정 (Sankey는 음수 링크 불가) ───────────────────────────────
  let renderable = true
  let reason: string | undefined
  const hasNegativeBucket = cogs < 0 || opex < 0 || fin < 0 || othersRaw.some((o) => o.value < 0)
  if (totalIncome <= 0) {
    renderable = false
    reason = '이 기간에는 수입이 없어 흐름도를 표시할 수 없습니다.'
  } else if (hasNegativeBucket) {
    renderable = false
    reason = '취소·환불로 일부 항목이 음수여서 흐름도를 표시할 수 없습니다.'
  } else if (merch <= 0) {
    renderable = false
    reason = '상품매출이 없어 손익 흐름도를 표시할 수 없습니다. 계정과목에서 매출 대분류를 지정해 주세요.'
  } else if (grossProfit < 0) {
    renderable = false
    reason = '매출원가가 상품매출을 초과해(매출총이익 음수) 흐름도를 표시할 수 없습니다.'
  } else if (operatingProfit < 0) {
    renderable = false
    reason = '영업이익이 음수여서 흐름도를 표시할 수 없습니다.'
  } else if (net < 0) {
    renderable = false
    reason = '이 기간은 순현금흐름이 적자여서 흐름도를 표시할 수 없습니다.'
  }

  if (!renderable) {
    return NextResponse.json({
      grain,
      period: { from: lo, to: hi, label: periodLabel },
      renderable: false,
      reason,
      totals,
      nodes: [],
      links: [],
    })
  }

  // ── 노드/링크 구성 (균형: 모든 노드 inflow==outflow, terminal net==table net) ──
  const nodes: { name: string }[] = []
  const idx = new Map<string, number>()
  const addNode = (key: string, name: string): number => {
    if (idx.has(key)) return idx.get(key)!
    const i = nodes.length
    nodes.push({ name })
    idx.set(key, i)
    return i
  }
  const links: { source: number; target: number; value: number }[] = []
  const link = (s: number, t: number, v: number) => {
    if (v > 0) links.push({ source: s, target: t, value: round2(v) })
  }

  const nIncome = addNode('income', '총수입')
  const nMerch = addNode('merch', '상품매출')
  const nCogs = addNode('cogs', '매출원가')
  const nGross = addNode('gross', '매출총이익')
  const nOpex = addNode('opex', '판매관리비')
  const nOp = addNode('op', '영업이익')
  const nFin = addNode('fin', '금융비용')
  const nNet = addNode('net', '순현금흐름')

  // 총수입 → 상품매출 / 기타수익ᵢ
  link(nIncome, nMerch, merch)
  const otherNodes = others.map((o, i) => addNode(`other:${i}`, o.name))
  others.forEach((o, i) => link(nIncome, otherNodes[i], o.value))

  // 상품매출 → 매출원가 / 매출총이익
  link(nMerch, nCogs, cogs)
  link(nMerch, nGross, grossProfit)

  // 판매관리비(OPEX) 배분: 먼저 매출총이익에서 차감, 부족분은 기타수익에서 비례 배분.
  const opexFromGross = Math.min(opex, grossProfit)
  const opexRemain = round2(opex - opexFromGross)
  link(nGross, nOpex, opexFromGross)
  link(nGross, nOp, round2(grossProfit - opexFromGross))

  others.forEach((o, i) => {
    const share = otherTotal > 0 ? round2(opexRemain * (o.value / otherTotal)) : 0
    link(otherNodes[i], nOpex, share)
    link(otherNodes[i], nOp, round2(o.value - share))
  })

  // 영업이익 → 금융비용 / 순현금흐름
  link(nOp, nFin, fin)
  link(nOp, nNet, net)

  return NextResponse.json({
    grain,
    period: { from: lo, to: hi, label: periodLabel },
    renderable: true,
    totals,
    nodes,
    links,
  })
}

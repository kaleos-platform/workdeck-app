/**
 * 손익 지표(순수 함수) — 현금흐름 상세의 거래 사실(fact)에서
 * 공헌이익 / 매출총이익 / 영업이익 / 공헌이익율 / 손익분기점 매출액을 산출.
 *
 * 분류 축(스키마 기존 필드 재사용, 이름 매칭 없음):
 *  - flowRole(대분류): MERCH_SALES=매출 / COGS=매출원가 / OPEX=영업비용 / FINANCING_COST=금융비용 / null=미지정
 *  - groupLabel(리프): '변동' / '고정' — 공헌이익의 변동비 판정
 *
 * 지표 정의(버킷·전체기간 동일):
 *  - 매출총이익 = 매출 − 매출원가
 *  - 공헌이익   = 매출 − 변동비        (변동비 = 매출원가·영업비용 중 groupLabel='변동')
 *  - 공헌이익율 = 공헌이익 / 매출       (매출 ≤ 0 → null)
 *  - 영업이익   = 매출 − 매출원가 − 영업비용  (금융비용·미지정은 영업외 → 제외)
 *  - 고정비     = (매출원가 + 영업비용) − 변동비
 *  - 손익분기점 매출액 = 고정비 / 공헌이익율   (공헌이익율 ≤ 0 → null)
 *
 * 방향 처리: 매출은 IN, 원가·영업비용은 OUT을 자연 방향으로 보고, 반대 방향 거래
 * (매출 카테고리의 환불 OUT 등)는 해당 지표에 음수로 net 반영해 엉뚱한 버킷 왜곡을 막는다.
 * 브라우저 의존 없음 → 유닛 테스트 대상.
 */
import type { FinFlowRole } from '@/generated/prisma/enums'

/** 변동비로 집계할 리프 groupLabel 값. */
export const VARIABLE_LABEL = '변동'

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** 지표 집계 입력 — 거래 1건의 손익 관련 사실. amount는 취소 부호 반영된 값(signedAmount). */
export interface PnlTxnFact {
  bucket: string
  direction: 'IN' | 'OUT'
  amount: number
  /** 대분류 flowRole(levelOne). */
  flowRole: FinFlowRole | null
  /** 리프 groupLabel('변동'/'고정'/…). */
  groupLabel: string | null
}

export interface PnlSeries {
  values: Record<string, number>
  total: number
}
export interface PnlRatioSeries {
  /** 버킷별 값(정의 불가 시 null). */
  values: Record<string, number | null>
  total: number | null
}

export interface PnlMetrics {
  buckets: string[]
  revenue: PnlSeries
  cogs: PnlSeries
  opex: PnlSeries
  variableCost: PnlSeries
  fixedCost: PnlSeries
  grossProfit: PnlSeries
  /** 매출총이익율(%). */
  grossMarginRatio: PnlRatioSeries
  contributionMargin: PnlSeries
  /** 공헌이익율(%). */
  contributionMarginRatio: PnlRatioSeries
  operatingIncome: PnlSeries
  /** 영업이익율(%). */
  operatingMarginRatio: PnlRatioSeries
  /** 손익분기점 매출액(공헌이익율 ≤ 0 → null). */
  breakEvenSales: PnlRatioSeries
}

const zeroMap = (buckets: string[]): Record<string, number> =>
  Object.fromEntries(buckets.map((b) => [b, 0]))

/** 버킷별 매출/매출원가/영업비용/변동비를 누적한 뒤 파생 지표를 계산. */
export function computePnlMetrics(facts: PnlTxnFact[], buckets: string[]): PnlMetrics {
  const bucketSet = new Set(buckets)
  const revenue = zeroMap(buckets)
  const cogs = zeroMap(buckets)
  const opex = zeroMap(buckets)
  const variableCost = zeroMap(buckets)

  for (const f of facts) {
    if (!bucketSet.has(f.bucket)) continue
    const inSigned = f.direction === 'IN' ? f.amount : -f.amount
    const outSigned = f.direction === 'OUT' ? f.amount : -f.amount
    const isVariable = f.groupLabel === VARIABLE_LABEL

    switch (f.flowRole) {
      case 'MERCH_SALES':
        revenue[f.bucket] += inSigned
        break
      case 'COGS':
        cogs[f.bucket] += outSigned
        if (isVariable) variableCost[f.bucket] += outSigned
        break
      case 'OPEX':
        opex[f.bucket] += outSigned
        if (isVariable) variableCost[f.bucket] += outSigned
        break
      // FINANCING_COST · null(미지정) → 영업 지표 제외
      default:
        break
    }
  }

  // 파생 금액 지표(버킷별) — 반올림.
  const grossProfit = zeroMap(buckets)
  const contributionMargin = zeroMap(buckets)
  const fixedCost = zeroMap(buckets)
  const operatingIncome = zeroMap(buckets)
  const gmRatio: Record<string, number | null> = {}
  const cmRatio: Record<string, number | null> = {}
  const omRatio: Record<string, number | null> = {}
  const bep: Record<string, number | null> = {}

  for (const b of buckets) {
    revenue[b] = round2(revenue[b])
    cogs[b] = round2(cogs[b])
    opex[b] = round2(opex[b])
    variableCost[b] = round2(variableCost[b])
    grossProfit[b] = round2(revenue[b] - cogs[b])
    contributionMargin[b] = round2(revenue[b] - variableCost[b])
    fixedCost[b] = round2(cogs[b] + opex[b] - variableCost[b])
    operatingIncome[b] = round2(revenue[b] - cogs[b] - opex[b])
    gmRatio[b] = ratio(grossProfit[b], revenue[b])
    const r = ratio(contributionMargin[b], revenue[b])
    cmRatio[b] = r
    omRatio[b] = ratio(operatingIncome[b], revenue[b])
    bep[b] = breakEven(fixedCost[b], r)
  }

  const sum = (m: Record<string, number>): number => round2(buckets.reduce((a, b) => a + m[b], 0))
  const totRevenue = sum(revenue)
  const totCogs = sum(cogs)
  const totOpex = sum(opex)
  const totVariable = sum(variableCost)
  const totCm = round2(totRevenue - totVariable)
  const totFixed = round2(totCogs + totOpex - totVariable)
  const totCmRatio = ratio(totCm, totRevenue)

  const series = (values: Record<string, number>, total: number): PnlSeries => ({ values, total })

  return {
    buckets,
    revenue: series(revenue, totRevenue),
    cogs: series(cogs, totCogs),
    opex: series(opex, totOpex),
    variableCost: series(variableCost, totVariable),
    fixedCost: series(fixedCost, totFixed),
    grossProfit: series(grossProfit, round2(totRevenue - totCogs)),
    grossMarginRatio: { values: gmRatio, total: ratio(round2(totRevenue - totCogs), totRevenue) },
    contributionMargin: series(contributionMargin, totCm),
    contributionMarginRatio: { values: cmRatio, total: totCmRatio },
    operatingIncome: series(operatingIncome, round2(totRevenue - totCogs - totOpex)),
    operatingMarginRatio: {
      values: omRatio,
      total: ratio(round2(totRevenue - totCogs - totOpex), totRevenue),
    },
    breakEvenSales: { values: bep, total: breakEven(totFixed, totCmRatio) },
  }
}

/** 공헌이익율(%) — 매출 ≤ 0 → null. */
function ratio(contributionMargin: number, revenue: number): number | null {
  if (revenue <= 0) return null
  return round2((contributionMargin / revenue) * 100)
}

/** 손익분기점 매출액 = 고정비 / 공헌이익율. 공헌이익율 ≤ 0 → null(정의 불가). */
function breakEven(fixedCost: number, cmRatioPct: number | null): number | null {
  if (cmRatioPct == null || cmRatioPct <= 0) return null
  return round2(fixedCost / (cmRatioPct / 100))
}

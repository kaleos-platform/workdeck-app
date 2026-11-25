import { formatDateToYmdKst } from '@/lib/date-range'

/**
 * 쿠팡 광고 「제외 키워드」 후보 규칙 — 서버 상수, 모든 작업 공간 공통(설정 화면 없음).
 * 계획: docs/superpowers/plans/2026-11-25-coupang-negative-keyword-cards.md
 *
 * 주문 = COALESCE(orders14d, orders1d) — 주간 분석(data-builder.ts)과 같은 기준.
 * 집계 단위 = 캠페인 × 검색어(adType·adGroup·optionId 합침).
 */
export const NEGATIVE_KEYWORD_RULES = {
  WINDOW_DAYS: 30,
  MIN_AD_COST: 10_000,
  MIN_CLICKS: 10,
  PROTECT_DAYS: 90,
  // 제거 당일·다음날·다다음날 지출은 광고센터 반영 지연으로 보고 경고하지 않는다.
  SPENDING_AFTER_REMOVAL_GRACE_DAYS: 2,
  DISMISS_DAYS: 30,
} as const

const DAY_MS = 24 * 60 * 60 * 1000

/** SQL 집계 결과 한 행(캠페인 × 검색어, 90일 창). 30일 합은 같은 쿼리에서 FILTER 로 계산. */
export interface KeywordAggRow {
  campaignId: string
  keyword: string
  adCost30: number
  clicks30: number
  orders30: number
  /** 30일 안에서 광고비가 나간 마지막 날(KST, YYYY-MM-DD) */
  lastSpendDate: string | null
  adCost90: number
  orders90: number
  revenue90: number
}

export interface KeywordStatusRow {
  campaignId: string
  keyword: string
  removedAt: Date | null
  dismissedUntil: Date | null
}

export interface CandidateKeyword {
  keyword: string
  adCost30: number
  clicks30: number
  orders30: number
  lastSpendDate: string | null
}

export interface ProtectedKeyword extends CandidateKeyword {
  orders90: number
  revenue90: number
  adCost90: number
  /** 90일 ROAS(%) — 광고비 0이면 null */
  roas90: number | null
}

export interface CampaignNegativeKeywords {
  campaignId: string
  campaignName: string
  /** 워크덱에서 제거 표시한 키워드 수(광고센터 실제 등록 수 아님) */
  removedCount: number
  candidates: CandidateKeyword[]
  protected: ProtectedKeyword[]
}

export interface SpendingAfterRemovalKeyword {
  campaignId: string
  campaignName: string
  keyword: string
  removedAt: string
  lastSpendDate: string
  lastSpendAmount: number
  /** 최근 30일 중 유예 이후 지출 합 */
  spendAfterRemoval: number
}

export interface NegativeKeywordCandidatesResponse {
  rules: typeof NEGATIVE_KEYWORD_RULES
  /** 집계 기간(KST, 양끝 포함). 오늘은 제외. */
  period: { start: string; end: string }
  campaigns: CampaignNegativeKeywords[]
  spendingAfterRemoval: SpendingAfterRemovalKeyword[]
}

/** YYYY-MM-DD (KST) */
export const kstDateKey = formatDateToYmdKst

/** 반열린 구간 [start, end) — end = 오늘 00:00 KST(오늘 제외). AdRecord.date 는 KST 자정 시각으로 저장된다. */
export function negativeKeywordWindow(now: Date) {
  const end = new Date(`${kstDateKey(now)}T00:00:00+09:00`)
  return {
    end,
    start30: new Date(end.getTime() - NEGATIVE_KEYWORD_RULES.WINDOW_DAYS * DAY_MS),
    start90: new Date(end.getTime() - NEGATIVE_KEYWORD_RULES.PROTECT_DAYS * DAY_MS),
  }
}

function statusKey(campaignId: string, keyword: string) {
  return `${campaignId}\u0000${keyword}`
}

/** 30일 조건(광고비·클릭·30일 주문 0) 충족 여부 */
function meets30DayRule(r: KeywordAggRow) {
  return (
    r.adCost30 >= NEGATIVE_KEYWORD_RULES.MIN_AD_COST &&
    r.clicks30 >= NEGATIVE_KEYWORD_RULES.MIN_CLICKS &&
    r.orders30 === 0
  )
}

/**
 * 후보·보호 분류. 후보 = 30일 조건 + 90일 주문 0 + 제거 표시 없음 + 「제외 안 함」 기간 아님.
 * 보호 = 30일 조건은 맞지만 90일 주문 > 0. 캠페인은 30일 지출이 있는 검색어가 있는 곳만 나온다.
 */
export function classifyKeywords(
  rows: KeywordAggRow[],
  statuses: KeywordStatusRow[],
  campaignNames: Map<string, string>,
  now: Date
): CampaignNegativeKeywords[] {
  const statusMap = new Map(statuses.map((s) => [statusKey(s.campaignId, s.keyword), s]))
  const removedCount = new Map<string, number>()
  for (const s of statuses) {
    if (s.removedAt) removedCount.set(s.campaignId, (removedCount.get(s.campaignId) ?? 0) + 1)
  }

  const byCampaign = new Map<string, CampaignNegativeKeywords>()
  for (const r of rows) {
    let c = byCampaign.get(r.campaignId)
    if (!c) {
      c = {
        campaignId: r.campaignId,
        campaignName: campaignNames.get(r.campaignId) ?? r.campaignId,
        removedCount: removedCount.get(r.campaignId) ?? 0,
        candidates: [],
        protected: [],
      }
      byCampaign.set(r.campaignId, c)
    }
    if (!meets30DayRule(r)) continue
    const status = statusMap.get(statusKey(r.campaignId, r.keyword))
    if (status?.removedAt) continue

    const base: CandidateKeyword = {
      keyword: r.keyword,
      adCost30: r.adCost30,
      clicks30: r.clicks30,
      orders30: r.orders30,
      lastSpendDate: r.lastSpendDate,
    }
    if (r.orders90 > 0) {
      c.protected.push({
        ...base,
        orders90: r.orders90,
        revenue90: r.revenue90,
        adCost90: r.adCost90,
        roas90: r.adCost90 > 0 ? Math.round((r.revenue90 / r.adCost90) * 100) : null,
      })
      continue
    }
    if (status?.dismissedUntil && status.dismissedUntil > now) continue
    c.candidates.push(base)
  }

  const sumCost = (c: CampaignNegativeKeywords) => c.candidates.reduce((a, k) => a + k.adCost30, 0)
  const list = [...byCampaign.values()]
  for (const c of list) {
    c.candidates.sort((a, b) => b.adCost30 - a.adCost30)
    c.protected.sort((a, b) => b.adCost30 - a.adCost30)
  }
  return list.sort(
    (a, b) => sumCost(b) - sumCost(a) || a.campaignName.localeCompare(b.campaignName)
  )
}

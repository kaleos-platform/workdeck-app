/**
 * 재무 관리 Deck — 분류 규칙 사용 현황(텍스트 매칭 기준). 순수 함수(prisma 미사용).
 *
 * matchedRuleId 는 쓰지 않는다: 확인·처리에서 학습 분류하면 matchedRuleId 가 새 완전일치 규칙으로
 * 바뀌고(staging/[id]), 일괄 분류는 null 로 지운다(staging/bulk). 그래서 부분포함 규칙은 실제로
 * 쓰여도 0건으로 잡혀 「미사용」으로 오표시된다. 대신 규칙 조건에 걸리는 확정 거래를 직접 센다.
 */
import { ruleMatchesText } from '@/lib/finance/classify-core'
import type { FinClassRuleMatchType, FinTxnDirection } from '@/generated/prisma/enums'

export type MatchText = {
  id: string
  accountId: string
  direction: FinTxnDirection
  /** 정규화 적요+상대(matchKeyOf) */
  text: string
  txnDate: Date
  categoryId: string | null
}

export type RuleCond = {
  id: string
  accountId: string | null
  matchKey: string
  matchType: FinClassRuleMatchType
  direction: FinTxnDirection | null
}

/** 조건 범위(계좌 지정 시 그 계좌) 안에서 조건에 걸리는 거래. 다른 규칙과의 우선순위는 무시. */
export function matchingTexts(cond: Omit<RuleCond, 'id'>, texts: MatchText[]): MatchText[] {
  return texts.filter(
    (t) =>
      (!cond.accountId || t.accountId === cond.accountId) &&
      ruleMatchesText(cond, t.text, t.direction)
  )
}

// ponytail: 규칙 R × 거래 T 선형 스캔(운영 R≈700, T 수천~수만 → 수십 ms). 10배 늘면 EXACT 를 text→목록 맵으로.
export function computeRuleUsage(
  rules: RuleCond[],
  texts: MatchText[]
): Map<string, { count: number; lastMatchedAt: Date | null }> {
  const out = new Map<string, { count: number; lastMatchedAt: Date | null }>()
  for (const r of rules) {
    let count = 0
    let last: Date | null = null
    for (const t of matchingTexts(r, texts)) {
      count++
      if (!last || t.txnDate > last) last = t.txnDate
    }
    out.set(r.id, { count, lastMatchedAt: last })
  }
  return out
}

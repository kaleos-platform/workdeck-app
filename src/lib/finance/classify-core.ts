/**
 * 재무 관리 Deck — 분류 규칙 매칭의 순수 부분(prisma 미사용). 클라이언트·순수 모듈에서 import 가능.
 */
import type { FinClassRuleMatchType, FinTxnDirection } from '@/generated/prisma/enums'

/** 규칙 하나가 정규화 텍스트에 걸리는지(우선순위 무시) — 사용 현황·미리보기용. */
export function ruleMatchesText(
  rule: { matchKey: string; matchType: FinClassRuleMatchType; direction: FinTxnDirection | null },
  text: string,
  direction: FinTxnDirection
): boolean {
  if (rule.direction && rule.direction !== direction) return false
  if (!text || !rule.matchKey) return false
  return rule.matchType === 'EXACT' ? rule.matchKey === text : text.includes(rule.matchKey)
}

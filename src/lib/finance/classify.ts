/**
 * 재무 관리 Deck — 학습 기반(결정적) 거래 자동 분류 엔진.
 *
 * 현금주의 모델에서 거래는 적요/상대(은행) 또는 가맹점명(카드)으로 계정과목에 매핑된다.
 * LLM 미사용 — FinClassRule(EXACT/KEYWORD) 규칙 매칭만 사용한다.
 *
 *   - EXACT  매칭(정규화 적요 전체 일치)  → CLASSIFIED (확정)
 *   - KEYWORD 매칭(부분 포함)            → REVIEW     (검토 제안)
 *   - 무매칭                              → UNCLASSIFIED
 *
 * 신뢰도 % 는 저장/표시하지 않는다(상태만). 사용자가 분류를 수정하면 learnRule 로
 * EXACT 규칙을 학습해 동일 적요를 다음부터 자동 분류한다.
 */
import { prisma } from '@/lib/prisma'
import { normalizeFinKey } from '@/lib/finance/kifrs-seed'
import type { FinClassRuleMatchType, FinClassStatus } from '@/generated/prisma/enums'

/** 매칭에 필요한 규칙 최소 형태 */
export type ClassRuleLite = {
  id: string
  matchKey: string
  matchType: FinClassRuleMatchType
  categoryId: string
}

export type ClassifyInput = {
  description?: string | null
  counterparty?: string | null
}

export type ClassifyResult = {
  categoryId: string | null
  classStatus: FinClassStatus
  matchedRuleId: string | null
}

/** Space의 모든 분류 규칙을 로드한다(임포트 1회 분류 시 1번만 호출해 재사용). */
export async function loadSpaceRules(spaceId: string): Promise<ClassRuleLite[]> {
  return prisma.finClassRule.findMany({
    where: { spaceId },
    select: { id: true, matchKey: true, matchType: true, categoryId: true },
  })
}

/** 적요 + 상대를 합쳐 정규화한 매칭 대상 텍스트. */
function buildMatchText(input: ClassifyInput): string {
  return normalizeFinKey([input.description ?? '', input.counterparty ?? ''].join(' '))
}

/**
 * 규칙 집합으로 입력을 분류한다(결정적·순수 함수).
 * 우선순위: EXACT(전체 일치) > KEYWORD(가장 긴 matchKey = 가장 구체적).
 */
export function classifyRow(input: ClassifyInput, rules: ClassRuleLite[]): ClassifyResult {
  const text = buildMatchText(input)
  if (!text) return { categoryId: null, classStatus: 'UNCLASSIFIED', matchedRuleId: null }

  // 1) EXACT — 정규화 전체 일치
  for (const rule of rules) {
    if (rule.matchType === 'EXACT' && rule.matchKey && text === rule.matchKey) {
      return { categoryId: rule.categoryId, classStatus: 'CLASSIFIED', matchedRuleId: rule.id }
    }
  }

  // 2) KEYWORD — 부분 포함, 가장 긴(구체적) 키워드 우선
  let best: ClassRuleLite | null = null
  for (const rule of rules) {
    if (rule.matchType !== 'KEYWORD' || !rule.matchKey) continue
    if (text.includes(rule.matchKey)) {
      if (!best || rule.matchKey.length > best.matchKey.length) best = rule
    }
  }
  if (best) {
    return { categoryId: best.categoryId, classStatus: 'REVIEW', matchedRuleId: best.id }
  }

  return { categoryId: null, classStatus: 'UNCLASSIFIED', matchedRuleId: null }
}

/**
 * 사용자 분류를 EXACT 규칙으로 학습한다(동일 적요 다음부터 자동 분류).
 * matchKey = 정규화한 적요(+상대). (spaceId, matchKey) 충돌 시 categoryId 갱신(사용자 정정 우선).
 * 반환: 학습된 규칙 id (적요가 비어 학습 불가하면 null).
 */
export async function learnRule(
  spaceId: string,
  input: ClassifyInput,
  categoryId: string
): Promise<string | null> {
  const matchKey = buildMatchText(input)
  if (!matchKey) return null

  const rule = await prisma.finClassRule.upsert({
    where: { spaceId_matchKey: { spaceId, matchKey } },
    update: { categoryId, matchType: 'EXACT', learnedFrom: 'USER' },
    create: { spaceId, matchKey, categoryId, matchType: 'EXACT', learnedFrom: 'USER' },
    select: { id: true },
  })
  return rule.id
}

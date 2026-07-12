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
import type {
  FinClassRuleMatchType,
  FinClassStatus,
  FinTxnDirection,
} from '@/generated/prisma/enums'

/** 매칭에 필요한 규칙 최소 형태 */
export type ClassRuleLite = {
  id: string
  matchKey: string
  matchType: FinClassRuleMatchType
  categoryId: string
  /** 방향 구분 — null = 방향 무관(이체/시드), IN/OUT = 해당 방향 전용 */
  direction: FinTxnDirection | null
  /** 규칙 학습 시 저장한 메모 — 자동분류(확정) 시 행 memo로 복사 */
  memo: string | null
}

export type ClassifyInput = {
  description?: string | null
  counterparty?: string | null
}

export type ClassifyResult = {
  categoryId: string | null
  classStatus: FinClassStatus
  matchedRuleId: string | null
  /** 매칭 규칙의 메모(무매칭 null). 소비처는 CLASSIFIED(확정)일 때만 행에 복사한다. */
  ruleMemo: string | null
}

/** Space의 모든 분류 규칙을 로드한다(임포트 1회 분류 시 1번만 호출해 재사용). */
export async function loadSpaceRules(spaceId: string): Promise<ClassRuleLite[]> {
  return prisma.finClassRule.findMany({
    where: { spaceId },
    select: {
      id: true,
      matchKey: true,
      matchType: true,
      categoryId: true,
      direction: true,
      memo: true,
    },
  })
}

/** 적요 + 상대를 합쳐 정규화한 매칭 대상 텍스트. */
function buildMatchText(input: ClassifyInput): string {
  return normalizeFinKey([input.description ?? '', input.counterparty ?? ''].join(' '))
}

/**
 * 규칙 집합으로 입력을 분류한다(결정적·순수 함수).
 * 우선순위: EXACT(전체 일치) > KEYWORD(가장 긴 matchKey = 가장 구체적).
 * 방향(IN/OUT) 인지: 같은 적요라도 방향-특정 규칙을 우선하고, 없으면 방향 무관(null) 규칙으로 폴백한다.
 * 반대 방향 전용 규칙은 매칭하지 않는다(비용/수입 분리).
 */
export function classifyRow(
  input: ClassifyInput,
  rules: ClassRuleLite[],
  direction: FinTxnDirection
): ClassifyResult {
  const text = buildMatchText(input)
  if (!text)
    return { categoryId: null, classStatus: 'UNCLASSIFIED', matchedRuleId: null, ruleMemo: null }

  // 1) EXACT — 정규화 전체 일치. 방향-특정 > 방향무관(null).
  let exactSpecific: ClassRuleLite | null = null
  let exactAny: ClassRuleLite | null = null
  for (const rule of rules) {
    if (rule.matchType !== 'EXACT' || rule.matchKey !== text) continue
    if (rule.direction === direction) {
      exactSpecific = rule
      break
    }
    if (rule.direction === null && !exactAny) exactAny = rule
  }
  const exact = exactSpecific ?? exactAny
  if (exact) {
    return {
      categoryId: exact.categoryId,
      classStatus: 'CLASSIFIED',
      matchedRuleId: exact.id,
      ruleMemo: exact.memo,
    }
  }

  // 2) KEYWORD — 부분 포함, 방향-특정 우선 그 안에서 가장 긴(구체적) 키워드.
  let bestSpecific: ClassRuleLite | null = null
  let bestAny: ClassRuleLite | null = null
  for (const rule of rules) {
    if (rule.matchType !== 'KEYWORD' || !rule.matchKey || !text.includes(rule.matchKey)) continue
    if (rule.direction === direction) {
      if (!bestSpecific || rule.matchKey.length > bestSpecific.matchKey.length) bestSpecific = rule
    } else if (rule.direction === null) {
      if (!bestAny || rule.matchKey.length > bestAny.matchKey.length) bestAny = rule
    }
  }
  const best = bestSpecific ?? bestAny
  if (best) {
    return {
      categoryId: best.categoryId,
      classStatus: 'REVIEW',
      matchedRuleId: best.id,
      ruleMemo: best.memo,
    }
  }

  return { categoryId: null, classStatus: 'UNCLASSIFIED', matchedRuleId: null, ruleMemo: null }
}

/**
 * 사용자 분류를 EXACT 규칙으로 학습한다(동일 적요·동일 방향 다음부터 자동 분류).
 * matchKey = 정규화한 적요(+상대), 방향(IN/OUT)별로 별개 규칙. 같은 적요라도 비용/수입 분리.
 * (spaceId, matchKey, direction) 충돌 시 categoryId 갱신(사용자 정정 우선).
 * memo: undefined=기존 유지, null=삭제, string=설정 (memo 미전달 호출부가 규칙 메모를 지우지 않도록).
 * 반환: 학습된 규칙 id (적요가 비어 학습 불가하면 null).
 */
export async function learnRule(
  spaceId: string,
  input: ClassifyInput,
  categoryId: string,
  direction: FinTxnDirection,
  memo?: string | null
): Promise<string | null> {
  const matchKey = buildMatchText(input)
  if (!matchKey) return null

  const rule = await prisma.finClassRule.upsert({
    where: { spaceId_matchKey_direction: { spaceId, matchKey, direction } },
    update: {
      categoryId,
      matchType: 'EXACT',
      learnedFrom: 'USER',
      ...(memo !== undefined ? { memo } : {}),
    },
    create: {
      spaceId,
      matchKey,
      categoryId,
      matchType: 'EXACT',
      learnedFrom: 'USER',
      direction,
      memo: memo ?? null,
    },
    select: { id: true },
  })
  return rule.id
}

/** 적요+상대를 정규화한 매칭 키(외부에서 sibling 계산 등에 재사용). */
export function matchKeyOf(input: ClassifyInput): string {
  return buildMatchText(input)
}

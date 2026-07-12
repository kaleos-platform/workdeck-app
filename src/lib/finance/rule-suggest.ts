/**
 * 재무 관리 Deck — 룰(키워드) 기반 계정 추천. AI 미사용·즉시.
 * 학습 규칙(FinClassRule) + 운영 차트 시드 키워드(영속화 안 함 — 추천 시점에만 합성 규칙)를
 * 합쳐 classifyRow로 매칭한다. 스테이징 목록 GET에서 행마다 배치로 계산해 자동 표시한다.
 */
import {
  classifyRow,
  loadSpaceRules,
  type ClassRuleLite,
  type ClassifyInput,
} from '@/lib/finance/classify'
import {
  flattenOperationalLeaves,
  normalizeFinKey,
  directionForType,
} from '@/lib/finance/kifrs-seed'
import type { FinTxnDirection } from '@/generated/prisma/enums'

export type RuleSuggestion = { categoryId: string; categoryName: string; reason: string }

type CatLite = { id: string; name: string; type: string }

/**
 * 학습 규칙 + 운영 차트 시드 키워드를 합친 룰셋 + 카테고리명 인덱스를 1회 구성한다.
 * (요청당 1회 호출해 모든 행에 재사용 — classifyRow는 순수 in-memory.)
 */
export async function loadRuleSuggestContext(
  spaceId: string,
  cats: CatLite[]
): Promise<{ ruleset: ClassRuleLite[]; nameById: Map<string, string> }> {
  const spaceRules = await loadSpaceRules(spaceId)
  const idByKey = new Map(cats.map((c) => [`${c.type}:${c.name}`, c.id]))
  const seedRules: ClassRuleLite[] = []
  for (const leaf of flattenOperationalLeaves()) {
    const catId = idByKey.get(`${leaf.type}:${leaf.name}`)
    if (!catId) continue
    for (const kw of leaf.kw) {
      const matchKey = normalizeFinKey(kw)
      if (!matchKey) continue
      seedRules.push({
        id: `seed:${matchKey}`,
        matchKey,
        matchType: 'KEYWORD',
        categoryId: catId,
        direction: directionForType(leaf.type),
        memo: null,
      })
    }
  }
  return {
    ruleset: [...spaceRules, ...seedRules],
    nameById: new Map(cats.map((c) => [c.id, c.name])),
  }
}

/** 단일 거래에 룰(키워드) 추천. 매칭 없으면 null. */
export function ruleSuggestionFor(
  input: ClassifyInput,
  direction: FinTxnDirection,
  ruleset: ClassRuleLite[],
  nameById: Map<string, string>
): RuleSuggestion | null {
  const r = classifyRow(input, ruleset, direction)
  if (!r.categoryId) return null
  const matchedSeed = r.matchedRuleId?.startsWith('seed:')
    ? r.matchedRuleId.slice('seed:'.length)
    : null
  return {
    categoryId: r.categoryId,
    categoryName: nameById.get(r.categoryId) ?? '',
    reason: matchedSeed ? `'${matchedSeed}' 키워드 일치` : '학습된 규칙과 일치',
  }
}

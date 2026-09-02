// AI 초안 후보 필터 + 등록 검색어 진단 — name-draft 라우트의 판정부를 뺀 순수 함수.
//
// 왜 병합 배열로 한 번에 검증하는가:
//   [등록된 검색어 ..., AI 후보 ...] 순서로 이어 붙여 validateKeywords 를 **한 번** 부르면
//   (1) 후보↔등록분 중복, (2) 후보끼리 중복, (3) 등록분 자체의 규칙 위반(=진단)이
//   한 패스에서 전부 나온다. validateKeywords 는 중복 계열에서 "먼저 등장한 쪽"을 남기므로
//   (keyword-validate.ts §중복 분기) 등록분을 앞에 두면 위반은 항상 후보 쪽에 붙는다.
//
// ⚠️ severity 로 필터하면 안 된다. 검색어 위반 10종 중 ERROR 는 KW_EFFICACY_TERM 과
//   KW_COMPETITOR_BRAND 둘뿐이고 후자는 기본 규칙셋의 competitorBrand 가 빈 배열이라
//   발화조차 하지 않는다(keyword-rules.ts). 나머지 — 상품명 중복(§10)을 포함해 — 는 전부
//   WARN 이라 `severity === 'ERROR'` 필터는 사실상 no-op 이 된다. 그래서 code 허용목록을 쓴다.
import type { KeywordIntent, KeywordReviewLabel } from './keyword-labels'
import { KEYWORD_INTENT_LABELS, KEYWORD_REVIEW_LABELS } from './keyword-labels'
import { normalizeKeyword } from './keyword-normalize'
import type { KeywordRuleSet } from './keyword-rules'
import { validateKeywords, type Violation, type ViolationCode } from './keyword-validate'

/** 결정적 규칙 위반 — 하나라도 붙으면 AI 후보를 버린다(결정 #2: 삭제는 여기까지만). */
const DRAFT_DROP_CODES: ReadonlySet<ViolationCode> = new Set<ViolationCode>([
  'KW_DUP_EXACT', // 등록분/후보 간 완전 중복
  'KW_DUP_SPACING_VARIANT', // §11 띄어쓰기 변형
  'KW_DUP_PERMUTATION', // §12 단어 순서만 다른 조합
  'KW_DUP_WITH_NAME', // §10 Rule 1 — 가이드가 "가장 중요"라 한 규칙
  'KW_NAME_COMPOUND', // §10 — 상품명 단어를 붙여 만든 복합어(한국어는 이쪽이 대부분이다)
  'KW_NAME_PARTIAL', // §10 — 상품명 단어가 섞인 조합. 후보는 아예 안 내보낸다
  'KW_DUP_WITH_CATEGORY', // §22 카테고리·구매옵션 재사용
  'KW_SHIPPING_TERM', // §19 배송 표현
  'KW_EFFICACY_TERM', // §19 효능 표현
  'KW_COMPETITOR_BRAND', // §19 경쟁 브랜드(규칙셋에 목록이 있을 때만 발화)
  'KW_TOO_LONG', // 25자 초과 — 의미 단위가 아님
])

// KW_OVER_LIMIT 은 의도적으로 뺐다. 판정이 "배열 위치 >= maxKeywords" 라서, 등록 검색어가
// 이미 상한만큼 있으면 **모든 후보가** 이 코드를 받는다(병합 배열의 뒤쪽에 있으므로).
// 후보에 붙여 내려보내는 violations 에서도 지운다 — 안 그러면 다이얼로그가 후보 전부에
// 경고 아이콘을 그린다. 반대로 등록분에 붙은 KW_OVER_LIMIT 은 진짜 진단이라 그대로 둔다.
const CANDIDATE_HIDDEN_CODES: ReadonlySet<ViolationCode> = new Set<ViolationCode>(['KW_OVER_LIMIT'])

/**
 * 등록된 검색어에 붙었을 때 **제거를 권하는** 코드. 후보 드롭 목록과 일부러 다르다 —
 * KW_NAME_PARTIAL 은 "이 부분만 빼면 쓸 수 있다"는 제안이라 지울 대상이 아니다.
 * 새 후보로 만들지 않는 것과, 이미 등록된 것을 지우라고 하는 것은 다른 판단이다.
 */
const REVIEW_REMOVE_CODES: ReadonlySet<ViolationCode> = new Set<ViolationCode>(
  [...DRAFT_DROP_CODES].filter((c) => c !== 'KW_NAME_PARTIAL')
)

/** AI 가 만든 검색어 후보 1건. */
export type DraftKeywordCandidate = { keyword: string; intent: KeywordIntent; reason: string }
/** AI 가 내린 등록 검색어 판정 1건. */
export type DraftReviewVerdict = { keyword: string; label: KeywordReviewLabel; reason: string }

/** 필터를 통과해 클라이언트로 내려가는 후보. 기존 {value, violations} 형태에 필드만 더했다. */
export type ScoredKeyword = {
  value: string
  violations: Violation[]
  intent: KeywordIntent
  intentLabel: string
  reason: string
}

/** 등록된 검색어 1건의 진단 결과. */
export type KeywordReview = {
  /** 등록된 원문 그대로 — 클라이언트가 정규화 기준으로 조인한다. */
  keyword: string
  label: KeywordReviewLabel
  labelText: string
  reason: string
  /** 결정적 검증기가 이 등록 검색어에 대해 잡은 위반(KW_OVER_LIMIT 포함). */
  violations: Violation[]
  recommendRemove: boolean
  /** 상품명 단어를 뺀 대안. 있으면 UI 가 원클릭 교체를 제공한다(지우는 게 아니라 고친다). */
  suggestion?: string
}

export type FilterDraftInput = {
  /** 이미 등록된 검색어. 병합 배열의 **앞쪽**에 놓인다. */
  existingKeywords: string[]
  candidates: DraftKeywordCandidate[]
  reviews: DraftReviewVerdict[]
  productName: string
  categoryNames?: string[]
  optionNames?: string[]
  /** 워크스페이스 브랜드명 — 상품명 단어로 치지 않는다. */
  brandNames?: string[]
  /** 분해 금지 단어 사전 */
  atomicWords?: string[]
  rules: KeywordRuleSet
  /** 최종적으로 남길 후보 수. */
  target: number
}

export type FilterDraftResult = { keywords: ScoredKeyword[]; reviews: KeywordReview[] }

export function filterDraftKeywords(input: FilterDraftInput): FilterDraftResult {
  const existing = input.existingKeywords.map((k) => k.trim()).filter(Boolean)
  const candidates = input.candidates.filter((c) => c.keyword.trim().length > 0)

  const offset = existing.length
  const merged = [...existing, ...candidates.map((c) => c.keyword.trim())]

  const byIndex = new Map<number, Violation[]>()
  if (merged.length > 0) {
    const result = validateKeywords({
      keywords: merged,
      productName: input.productName,
      categoryNames: input.categoryNames ?? [],
      optionNames: input.optionNames ?? [],
      brandNames: input.brandNames ?? [],
      atomicWords: input.atomicWords ?? [],
      rules: input.rules,
    })
    for (const v of result.violations) {
      if (v.keywordIndex === null) continue
      const list = byIndex.get(v.keywordIndex)
      if (list) list.push(v)
      else byIndex.set(v.keywordIndex, [v])
    }
  }

  // ── 등록 검색어 진단 ─────────────────────────────────────────────────────
  // AI 판정은 정규화 기준으로 조인한다. despace 까지 쓰면 "밀프렙 용기"와 "밀프렙용기"가
  // 하나의 판정을 공유해 엉뚱한 제거를 유도한다.
  const verdictByKey = new Map(input.reviews.map((r) => [normalizeKeyword(r.keyword), r]))
  const reviews: KeywordReview[] = existing.map((keyword, index) => {
    const violations = byIndex.get(index) ?? []
    const verdict = verdictByKey.get(normalizeKeyword(keyword))
    const label: KeywordReviewLabel = verdict?.label ?? 'KEEP'
    const suggestion = violations.find((v) => v.suggestion)?.suggestion
    return {
      keyword,
      label,
      labelText: KEYWORD_REVIEW_LABELS[label],
      reason: verdict?.reason ?? '',
      violations,
      // 제안이 있으면 지우라고 하지 않는다 — 사용자가 고칠 수 있는 것을 삭제로 몰지 않는다.
      recommendRemove:
        !suggestion &&
        (label !== 'KEEP' || violations.some((v) => REVIEW_REMOVE_CODES.has(v.code))),
      suggestion,
    }
  })

  // ── 후보 필터 ────────────────────────────────────────────────────────────
  // 정렬하지 않는다 — 순서는 "구매 의도가 높은 순"으로 모델이 만든 것이고, 서버가 다시
  // 섞으면 그 근거가 사라진다. 통과분이 target 미만이면 미만인 채로 내린다(버린 후보를
  // 되살려 자리를 채우면 규칙 위반을 다시 들여오는 꼴이다).
  const keywords: ScoredKeyword[] = []
  for (let i = 0; i < candidates.length && keywords.length < input.target; i += 1) {
    const violations = byIndex.get(offset + i) ?? []
    if (violations.some((v) => DRAFT_DROP_CODES.has(v.code))) continue
    const candidate = candidates[i]
    keywords.push({
      value: candidate.keyword.trim(),
      violations: violations.filter((v) => !CANDIDATE_HIDDEN_CODES.has(v.code)),
      intent: candidate.intent,
      intentLabel: KEYWORD_INTENT_LABELS[candidate.intent],
      reason: candidate.reason,
    })
  }

  return { keywords, reviews }
}

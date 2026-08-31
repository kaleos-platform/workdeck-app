// 상품명·검색어 규칙 검증 — `docs/쿠팡 상품명 및 검색어 운영 가이드.md` 기준.
// 순수 함수만 둔다(클라이언트 번들에 들어가므로 prisma 등 서버 전용 모듈 금지).

import { tokenizeProductName } from '@/lib/inv/search-tokens'
import {
  despaceKeyword,
  stripNameTokens,
  keywordKeys,
  normalizeKeyword,
  splitTokens,
  type KeywordKeys,
} from './keyword-normalize'
import { rulesForNameField, type KeywordRuleSet } from './keyword-rules'

export type ViolationSeverity = 'ERROR' | 'WARN' | 'INFO'

export type ViolationCode =
  | 'NAME_TOO_SHORT'
  | 'NAME_BELOW_TARGET'
  | 'NAME_ABOVE_TARGET'
  | 'NAME_ABOVE_SOFT_MAX'
  | 'NAME_ABOVE_HARD_MAX'
  | 'NAME_REPEATED_TOKEN'
  | 'NAME_PROMO_TERM'
  | 'NAME_SELLER_TERM'
  | 'NAME_SPECIAL_CHARS'
  | 'NAME_COMPETITOR_BRAND'
  | 'KW_OVER_LIMIT'
  | 'KW_DUP_WITH_NAME'
  | 'KW_NAME_COMPOUND'
  | 'KW_NAME_PARTIAL'
  | 'KW_DUP_SPACING_VARIANT'
  | 'KW_DUP_PERMUTATION'
  | 'KW_DUP_EXACT'
  | 'KW_DUP_WITH_CATEGORY'
  | 'KW_SHIPPING_TERM'
  | 'KW_EFFICACY_TERM'
  | 'KW_COMPETITOR_BRAND'
  | 'KW_TOO_LONG'

export type Violation = {
  code: ViolationCode
  severity: ViolationSeverity
  /** 상품명 위반이면 null, 검색어면 해당 index */
  keywordIndex: number | null
  /** 한국어. UI 가 그대로 렌더한다. */
  message: string
  /** 충돌 상대 토큰/키워드 (하이라이트용) */
  conflictWith?: string
  /**
   * 이렇게 고치면 된다는 제안 (KW_NAME_PARTIAL). UI 가 원클릭 교체에 그대로 쓴다.
   * 제안이 있는 위반은 "지울 것"이 아니라 "고칠 것"이라 cleaned 에서 빼지 않는다.
   */
  suggestion?: string
}

// KeywordRuleSet 에는 하한 필드가 없다(가이드 §7 이 목표 40자만 규정).
// 40자 미만은 INFO 로 안내하되, 상품 종류조차 알 수 없는 극단적 짧음은 별도로 경고한다.
const NAME_MIN_LENGTH = 10

// 검색어 1건의 길이 상한. 쿠팡이 명시한 값은 아니고, §12 "의미 단위로 관리" 취지에서
// 문장 수준으로 길어진 검색어를 잡기 위한 내부 기준.
const KEYWORD_MAX_LENGTH = 25

// 상품명 단어를 걷어낸 나머지가 이보다 짧으면 검색어로 쓸 수 없다고 본다 —
// '브라탑' → '탑', '노와이어브라' → '' 처럼 고칠 대상이 아니라 지울 대상이다.
const MIN_STRIPPED_LENGTH = 2

/** 마지막 글자의 받침 코드. 한글 음절이 아니면 null. */
function finalConsonant(word: string): number | null {
  const last = word.trim().slice(-1)
  if (!last) return null
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return null
  return (code - 0xac00) % 28
}

/** 은/는 — '클렌징폼는' 같은 문장이 그대로 사용자에게 나간다. */
export function topicParticle(word: string): string {
  const jong = finalConsonant(word)
  if (jong === null) return '는'
  return jong === 0 ? '는' : '은'
}

/** 로/으로 — 'ㄹ' 받침은 '로' 를 쓴다('크림으로', '설로'가 아니라 '설로'). */
export function directionParticle(word: string): string {
  const jong = finalConsonant(word)
  if (jong === null) return '로'
  // 8 = 'ㄹ'. 받침이 없거나 ㄹ 이면 '로', 나머지는 '으로'.
  return jong === 0 || jong === 8 ? '로' : '으로'
}

// 소프트 임계로만 세는 일반 특수문자(§8.4 — 괄호·느낌표 등은 정상 상품명에도 쓰인다).
const SOFT_SPECIAL_CHARS = /[[\]()<>{}!~@#$%^&*"'?]/g

type TextKeys = { normalized: string; despaced: string }

function textKeys(raw: string): TextKeys {
  return { normalized: normalizeKeyword(raw), despaced: despaceKeyword(raw) }
}

/**
 * 금지어 포함 여부. 정규화 형태에서 먼저 찾고, 구분자를 지운 형태로도 찾는다
 * ("무료 배송"처럼 띄어 쓴 회피형을 잡기 위함).
 * 단 '1+1' 처럼 구분자가 의미의 일부인 금지어는 despaced 비교를 건너뛴다
 * (제거하면 '11' 이 되어 '110g' 같은 정상 표기를 오탐한다).
 */
function hasTerm(text: TextKeys, term: string): boolean {
  const n = normalizeKeyword(term)
  if (!n) return false
  if (text.normalized.includes(n)) return true
  const d = despaceKeyword(term)
  if (d.length >= 2 && d === n.replace(/\s+/g, '')) return text.despaced.includes(d)
  return false
}

function findTerms(text: TextKeys, terms: string[]): string[] {
  return terms.filter((t) => hasTerm(text, t))
}

/**
 * §10 Rule 1 — 검색어가 상품명과 중복인지.
 * "모든 토큰이 상품명 토큰" 이거나 "공백을 지운 형태가 상품명에 그대로 들어있는" 경우만 참.
 * "아무 토큰이나 겹치면" 으로 잡으면 §9 의 올바른 예 '페이스 타월'(타월이 상품명에 있음)까지
 * 걸려서, 가이드가 권장한 검색어를 위반으로 만든다.
 */
export function overlapsProductName(keyword: string, productName: string): boolean {
  const nameTokens = tokenizeProductName(productName ?? '', Number.POSITIVE_INFINITY)
  return (
    overlapsNameTokens(
      keyword,
      new Set(nameTokens.map((t) => t.toLowerCase())),
      despaceKeyword(productName ?? ''),
      nameTokens
    ) !== null
  )
}

/**
 * 왜 "고칠 수 없어서 지워야 하는가". 셋을 한 메시지로 뭉뚱그리면 거짓말이 된다 —
 * '클렌징폼' 은 '폼' 이 남는데도 "상품명 단어만으로 이뤄졌다"고 말하고 있었다.
 */
type CompoundReason =
  | 'all-name-words' // 상품명 단어만으로 이뤄졌다 (남는 게 없다)
  | 'leftover-too-short' // 남은 조각이 한 글자뿐이라 검색어가 못 된다
  | 'leftover-already-registered' // 남은 조각이 이미 등록된 다른 검색어다

/**
 * 상품명 중복 판정 결과. 어느 게이트가 잡았는지까지 돌려준다 — 코드·메시지가 게이트마다 다르다.
 */
type NameOverlap =
  | { kind: 'all-tokens' }
  | { kind: 'substring' }
  | { kind: 'compound'; reason: CompoundReason; removed: string[]; leftover: string }
  | { kind: 'partial'; suggestion: string; removed: string[] }

/**
 * 게이트 순서는 **all-tokens → substring → compound** 이고, compound 는 앞의 둘이 모두
 * 실패했을 때만 평가한다. 이 순서가 §9 오라클(keyword-validate.test.ts)을 지키는 장치다 —
 * `40수 타월`(all-tokens)·`호텔타월`(substring)·`커버브라`(substring, 상품명에 `커버 브라` 가
 * 인접)는 전부 기존 KW_DUP_WITH_NAME 으로 남아야 한다. compound 를 앞으로 옮기면 코드와
 * conflictWith 가 바뀌어 그 테스트들이 죽는다.
 */
function overlapsNameTokens(
  keyword: string,
  nameTokenSet: Set<string>,
  nameDespaced: string,
  nameTokens: string[],
  /**
   * 이 조각이 상품명이나 **이미 등록된 다른 검색어**에 있는가. 남은 조각이 이미 등록돼 있으면
   * 그걸 제안해봐야 중복만 만든다 — 고칠 수 없으니 지우라고 해야 한다.
   */
  isKnownTerm: (term: string) => boolean = () => false
): NameOverlap | null {
  const kwTokens = splitTokens(keyword).map((t) => t.toLowerCase())
  const despaced = despaceKeyword(keyword)
  if (kwTokens.length > 0 && kwTokens.every((t) => nameTokenSet.has(t)))
    return { kind: 'all-tokens' }
  if (despaced.length > 0 && nameDespaced.includes(despaced)) return { kind: 'substring' }

  // §10 한국어 복합어·부분 포함 — `노와이어브라`·`여름브라` 처럼 상품명 단어를 붙여 쓴 검색어.
  // 앞의 두 게이트는 구조적으로 못 잡는다(토큰 1개라 완전 일치 불가, 어순이 달라 부분문자열도 불가).
  // 띄어 쓴 조합은 건드리지 않는다 — 가이드 §9 가 '페이스 타월'(타월이 상품명에 있다)을
  // 올바른 예로 명시한다. 문제로 보는 건 '여름브라' 처럼 한 덩어리로 붙여 쓴 쪽이다.
  if (kwTokens.length !== 1) return null

  // 잘라내는 것은 **상품명 단어로만** 한다. 등록 검색어까지 사전에 넣으면 상품명과 무관한
  // '아기물티슈' 가 등록된 '아기' 때문에 걸려 "상품명 단어가 들었다"는 거짓 메시지가 나간다.
  const strip = stripNameTokens(keyword, nameTokens)
  if (!strip) return null
  const rest = despaceKeyword(strip.stripped)

  // 고칠 수 있으려면 남은 조각이 **쓸 수 있는 새 단어**여야 한다. 아니면 지우는 수밖에 없다.
  if (rest.length === 0) {
    return { kind: 'compound', reason: 'all-name-words', removed: strip.removed, leftover: '' }
  }
  if (rest.length < MIN_STRIPPED_LENGTH) {
    return {
      kind: 'compound',
      reason: 'leftover-too-short',
      removed: strip.removed,
      leftover: strip.stripped,
    }
  }
  if (isKnownTerm(rest)) {
    return {
      kind: 'compound',
      reason: 'leftover-already-registered',
      removed: strip.removed,
      leftover: strip.stripped,
    }
  }
  // 남은 조각이 진짜 새 진입로다. 지우는 게 아니라 이렇게 고치자고 제안한다.
  return { kind: 'partial', suggestion: strip.stripped, removed: strip.removed }
}

export type NameValidationResult = {
  length: number
  violations: Violation[]
}

export function validateProductName(name: string, rules: KeywordRuleSet): NameValidationResult {
  const trimmed = String(name ?? '').trim()
  const length = trimmed.length
  const violations: Violation[] = []
  const keys = textKeys(trimmed)

  // ─── §7 길이 ─────────────────────────────────────────────────────────────
  // 구간은 배타적으로 하나만 보고한다(같은 사실을 두 줄로 알리지 않는다).
  if (length < NAME_MIN_LENGTH) {
    violations.push({
      code: 'NAME_TOO_SHORT',
      severity: 'WARN',
      keywordIndex: null,
      message: `상품명이 ${length}자로 너무 짧습니다. 고객이 상품 종류를 이해할 수 있는 정보를 담아주세요.`,
    })
  } else if (length < rules.nameTargetMin) {
    violations.push({
      code: 'NAME_BELOW_TARGET',
      severity: 'INFO',
      keywordIndex: null,
      message: `상품명이 ${length}자입니다. 권장 구간은 ${rules.nameTargetMin}~${rules.nameTargetMax}자입니다.`,
    })
  } else if (length > rules.nameHardMax) {
    violations.push({
      code: 'NAME_ABOVE_HARD_MAX',
      severity: 'ERROR',
      keywordIndex: null,
      message: `상품명이 ${length}자로 운영 상한 ${rules.nameHardMax}자를 넘었습니다. 반드시 줄여주세요.`,
    })
  } else if (length > rules.nameSoftMax) {
    violations.push({
      code: 'NAME_ABOVE_SOFT_MAX',
      severity: 'WARN',
      keywordIndex: null,
      message: `상품명이 ${length}자입니다. 모바일 가독성을 위해 ${rules.nameSoftMax}자 이하를 권장합니다.`,
    })
  } else if (length > rules.nameTargetMax) {
    violations.push({
      code: 'NAME_ABOVE_TARGET',
      severity: 'INFO',
      keywordIndex: null,
      message: `상품명이 ${length}자입니다. 권장 구간은 ${rules.nameTargetMin}~${rules.nameTargetMax}자입니다.`,
    })
  }

  // ─── §8.1 키워드 반복 ────────────────────────────────────────────────────
  // tokenizeProductName 은 중복을 제거하므로 반복이 보이지 않는다. 원시 토큰을 쓴다.
  const counts = new Map<string, { count: number; sample: string }>()
  for (const token of splitTokens(trimmed)) {
    const key = token.toLowerCase()
    const hit = counts.get(key)
    if (hit) hit.count += 1
    else counts.set(key, { count: 1, sample: token })
  }
  for (const { count, sample } of counts.values()) {
    if (count < 2) continue
    violations.push({
      code: 'NAME_REPEATED_TOKEN',
      severity: 'WARN',
      keywordIndex: null,
      message: `'${sample}'가 상품명에 ${count}번 반복됩니다. 같은 단어는 한 번만 사용합니다.`,
      conflictWith: sample,
    })
  }

  // ─── §8.2 프로모션 + §19 배송 문구 ───────────────────────────────────────
  // 오탐 주의: '신상품'·'BEST' 가 정당한 브랜드/라인명의 일부일 수 있어 WARN(무시 가능)으로 둔다.
  // 두 목록에 같은 단어가 있으면(예: '무료배송') 같은 사실을 두 번 알리게 되므로 합쳐서 중복 제거한다.
  const promoTerms = [
    ...new Set([...rules.bannedTerms.promo, ...rules.bannedTerms.shipping].map((t) => t.trim())),
  ]
  const promoHits = findTerms(keys, promoTerms)
  for (const term of promoHits) {
    violations.push({
      code: 'NAME_PROMO_TERM',
      severity: 'WARN',
      keywordIndex: null,
      message: `상품명에 프로모션·배송 표현 '${term}'이 있습니다. 상품명에는 사용하지 않습니다.`,
      conflictWith: term,
    })
  }

  // ─── §8.3 판매자 이름 ────────────────────────────────────────────────────
  for (const term of findTerms(keys, rules.bannedTerms.seller)) {
    violations.push({
      code: 'NAME_SELLER_TERM',
      severity: 'WARN',
      keywordIndex: null,
      message: `상품명에 판매자 표현 '${term}'이 있습니다. 상품 브랜드와 판매자명은 구분합니다.`,
      conflictWith: term,
    })
  }

  // ─── §8.4 특수문자 ───────────────────────────────────────────────────────
  if (rules.specialCharPattern.test(trimmed)) {
    violations.push({
      code: 'NAME_SPECIAL_CHARS',
      severity: 'WARN',
      keywordIndex: null,
      message: '상품명에 장식용 특수문자가 있습니다. 일반적인 문장형 띄어쓰기를 사용합니다.',
    })
  } else {
    const softCount = (trimmed.match(SOFT_SPECIAL_CHARS) ?? []).length
    if (softCount > rules.specialCharSoftLimit) {
      violations.push({
        code: 'NAME_SPECIAL_CHARS',
        severity: 'WARN',
        keywordIndex: null,
        message: `상품명의 특수문자가 ${softCount}개입니다. ${rules.specialCharSoftLimit}개 이하로 줄여주세요.`,
      })
    }
  }

  // ─── §8.5 경쟁 브랜드 ────────────────────────────────────────────────────
  for (const term of findTerms(keys, rules.bannedTerms.competitorBrand)) {
    violations.push({
      code: 'NAME_COMPETITOR_BRAND',
      severity: 'ERROR',
      keywordIndex: null,
      message: `상품명에 경쟁 브랜드 '${term}'이 있습니다. 자사 상품이 아니면 사용할 수 없습니다.`,
      conflictWith: term,
    })
  }

  return { length, violations }
}

// ─── 검색어 ────────────────────────────────────────────────────────────────

export type KeywordValidationResult = {
  violations: Violation[]
  /** 위반이 하나도 없는 검색어만 (규칙 위반 정리 버튼이 쓴다) */
  cleaned: string[]
  /** maxKeywords 초과분 */
  overflow: string[]
}

export type ValidateKeywordsInput = {
  keywords: string[]
  productName: string
  categoryNames?: string[]
  /** 구매 옵션 (§22 STEP08) */
  optionNames?: string[]
  rules: KeywordRuleSet
}

function lowerTokenSet(sources: string[]): Set<string> {
  const set = new Set<string>()
  for (const src of sources) {
    for (const token of splitTokens(src)) set.add(token.toLowerCase())
  }
  return set
}

export function validateKeywords(input: ValidateKeywordsInput): KeywordValidationResult {
  const { rules } = input
  const violations: Violation[] = []

  // §10 Rule 1 — 상품명 토큰. 12개 상한을 적용하면 40~70자 한국어 상품명의 13번째 이후
  // 단어와 겹치는 검색어가 검증을 통과해버리므로 전체 토큰을 받는다.
  const nameTokens = tokenizeProductName(input.productName ?? '', Number.POSITIVE_INFINITY)
  const nameTokenSet = new Set(nameTokens.map((t) => t.toLowerCase()))
  const nameDespaced = despaceKeyword(input.productName ?? '')

  const categoryTokenSet = lowerTokenSet(input.categoryNames ?? [])
  const optionTokenSet = lowerTokenSet(input.optionNames ?? [])

  const firstByNormalized = new Map<string, string>()
  const firstByDespaced = new Map<string, string>()
  const firstBySorted = new Map<string, string>()

  const entries: { index: number; raw: string; keys: KeywordKeys }[] = []

  input.keywords.forEach((raw, index) => {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) return
    entries.push({ index, raw: trimmed, keys: keywordKeys(trimmed) })
  })

  // "남은 조각이 이미 등록된 검색어인가" 판정용 색인. 자기 자신은 제외해야 한다 —
  // 안 그러면 모든 검색어가 자기 자신과 겹친다고 나온다.
  const termIndexByDespaced = new Map<string, number[]>()
  for (const e of entries) {
    const list = termIndexByDespaced.get(e.keys.despaced)
    if (list) list.push(e.index)
    else termIndexByDespaced.set(e.keys.despaced, [e.index])
  }
  const isRegisteredTerm = (term: string, selfIndex: number): boolean =>
    (termIndexByDespaced.get(term) ?? []).some((i) => i !== selfIndex)

  const flagged = new Set<number>()
  const push = (v: Violation) => {
    violations.push(v)
    if (v.keywordIndex !== null) flagged.add(v.keywordIndex)
  }
  // 고칠 제안이 붙은 위반은 cleaned 에서 빼지 않는다 — "규칙 위반 정리"가 지워버리면
  // 사용자가 제안대로 고칠 기회를 잃는다. 표시는 하되 삭제 대상은 아니다.
  const pushUnflagged = (v: Violation) => {
    violations.push(v)
  }

  entries.forEach((entry, position) => {
    const { index, raw, keys } = entry
    const kwTokens = splitTokens(raw).map((t) => t.toLowerCase())
    const textKey: TextKeys = { normalized: keys.normalized, despaced: keys.despaced }

    // §10 초과분 — 입력 순서 기준으로 잘라낸다.
    // §18 우선순위(동의어>용도>소재…)로 자르려면 키워드별 type/score 가 필요한데
    // 이 함수의 입력에는 없다. 우선순위 절삭은 풀 정보를 가진 호출부(suggest)의 몫.
    // 기준은 배열 인덱스가 아니라 "비어 있지 않은 검색어 중 몇 번째인가"다.
    // 편집 화면의 빈 행이 섞이면 인덱스 기준으로는 멀쩡한 20번째가 초과로 몰린다.
    if (position >= rules.maxKeywords) {
      push({
        code: 'KW_OVER_LIMIT',
        severity: 'WARN',
        keywordIndex: index,
        message: `검색어는 최대 ${rules.maxKeywords}개입니다. 우선순위가 낮은 검색어를 정리해주세요.`,
      })
    }

    if (raw.length > KEYWORD_MAX_LENGTH) {
      push({
        code: 'KW_TOO_LONG',
        severity: 'WARN',
        keywordIndex: index,
        message: `검색어가 ${raw.length}자로 너무 깁니다. 의미 단위로 나눠주세요.`,
      })
    }

    // ─── 중복 계열 — 먼저 등장한 쪽을 남기고 나중 것만 표시한다 ───────────
    // (양쪽을 다 표시하면 cleaned 에서 둘 다 사라져 "정리" 버튼이 키워드를 통째로 지운다)
    const exactFirst = firstByNormalized.get(keys.normalized)
    const despacedFirst = firstByDespaced.get(keys.despaced)
    const sortedFirst = firstBySorted.get(keys.sortedKey)
    if (exactFirst !== undefined) {
      push({
        code: 'KW_DUP_EXACT',
        severity: 'WARN',
        keywordIndex: index,
        message: `'${raw}'는 이미 등록된 검색어와 같습니다.`,
        conflictWith: exactFirst,
      })
    } else if (despacedFirst !== undefined) {
      // §11 띄어쓰기만 다른 변형
      push({
        code: 'KW_DUP_SPACING_VARIANT',
        severity: 'WARN',
        keywordIndex: index,
        message: `'${raw}'는 '${despacedFirst}'의 띄어쓰기 변형입니다. 한 가지 형태만 사용합니다.`,
        conflictWith: despacedFirst,
      })
    } else if (sortedFirst !== undefined) {
      // §12 단어 순서만 바꾼 조합
      push({
        code: 'KW_DUP_PERMUTATION',
        severity: 'WARN',
        keywordIndex: index,
        message: `'${raw}'는 '${sortedFirst}'와 단어 순서만 다릅니다. 조합을 반복하지 않습니다.`,
        conflictWith: sortedFirst,
      })
    }
    if (exactFirst === undefined) firstByNormalized.set(keys.normalized, raw)
    if (despacedFirst === undefined) firstByDespaced.set(keys.despaced, raw)
    if (sortedFirst === undefined) firstBySorted.set(keys.sortedKey, raw)

    // ─── §10 Rule 1 상품명 중복 ──────────────────────────────────────────
    // 판정은 overlapsNameTokens 한 곳에서만 한다(suggest 와 규칙이 갈리지 않도록).
    const overlap = overlapsNameTokens(raw, nameTokenSet, nameDespaced, nameTokens, (term) =>
      isRegisteredTerm(term, index)
    )
    if (overlap?.kind === 'partial') {
      // 지울 것이 아니라 고칠 것이다 — push 가 아니라 pushUnflagged 로 넣어 cleaned 에 남긴다.
      // (일괄 삭제 버튼이 이걸 지우면 사용자가 고칠 기회를 잃는다)
      pushUnflagged({
        code: 'KW_NAME_PARTIAL',
        severity: 'WARN',
        keywordIndex: index,
        message: `'${raw}'에는 상품명 단어(${overlap.removed.join(', ')})가 들어 있습니다. 상품명 단어는 이미 검색에 잡히니 '${overlap.suggestion}'처럼 남은 부분만 쓰는 편이 낫습니다.`,
        conflictWith: overlap.removed.join(', '),
        suggestion: overlap.suggestion,
      })
    } else if (overlap?.kind === 'compound') {
      // 상품명에 그 문자열이 통째로 들어있는 건 아니므로 "이미 있습니다"라고 하면 거짓말이다.
      // 왜 고칠 수 없는지(사유)까지 말해야 사용자가 판정을 납득한다.
      const pieces = overlap.removed.join(' + ')
      const why =
        overlap.reason === 'all-name-words'
          ? `상품명 단어(${pieces})만으로 이뤄져 있어 뺄 것이 남지 않습니다.`
          : overlap.reason === 'leftover-too-short'
            ? `상품명 단어(${pieces})를 빼면 '${overlap.leftover}' 한 글자만 남아 검색어로 쓸 수 없습니다.`
            : `상품명 단어(${pieces})를 빼면 '${overlap.leftover}'가 되는데, 이미 등록된 검색어라 중복이 됩니다.`
      push({
        code: 'KW_NAME_COMPOUND',
        severity: 'WARN',
        keywordIndex: index,
        message: `'${raw}'${topicParticle(raw)} ${why} 상품명 단어는 이미 검색에 잡히므로 이 검색어는 새 유입을 만들지 못합니다.`,
        conflictWith: pieces,
      })
    } else if (overlap) {
      const allTokensInName = overlap.kind === 'all-tokens'
      const conflict = allTokensInName
        ? kwTokens.join(' ')
        : nameTokens.filter((t) => keys.despaced.includes(t.toLowerCase())).join(' ') ||
          input.productName.trim()
      push({
        code: 'KW_DUP_WITH_NAME',
        severity: 'WARN',
        keywordIndex: index,
        message: `'${raw}'는 상품명에 이미 있습니다. 상품명 단어는 검색어에 다시 넣지 않습니다.`,
        conflictWith: conflict,
      })
    } else {
      // ─── §22 STEP08 카테고리·구매옵션 중복 ─────────────────────────────
      // ViolationCode 에 옵션 전용 코드가 없어 KW_DUP_WITH_CATEGORY 를 재사용하고
      // 메시지로 구매옵션임을 구분한다.
      const allInCategory =
        categoryTokenSet.size > 0 &&
        kwTokens.length > 0 &&
        kwTokens.every((t) => categoryTokenSet.has(t))
      const allInOption =
        optionTokenSet.size > 0 &&
        kwTokens.length > 0 &&
        kwTokens.every((t) => optionTokenSet.has(t))
      if (allInCategory || allInOption) {
        push({
          code: 'KW_DUP_WITH_CATEGORY',
          severity: 'WARN',
          keywordIndex: index,
          message: allInCategory
            ? `'${raw}'는 카테고리에 이미 포함된 표현입니다.`
            : `'${raw}'는 구매옵션에 이미 포함된 표현입니다.`,
        })
      }
    }

    // ─── §19 금지 규칙 ───────────────────────────────────────────────────
    for (const term of findTerms(textKey, rules.bannedTerms.shipping)) {
      push({
        code: 'KW_SHIPPING_TERM',
        severity: 'WARN',
        keywordIndex: index,
        message: `'${term}' 같은 배송 표현은 검색어로 사용하지 않습니다.`,
        conflictWith: term,
      })
    }
    for (const term of findTerms(textKey, rules.bannedTerms.efficacy)) {
      push({
        code: 'KW_EFFICACY_TERM',
        severity: 'ERROR',
        keywordIndex: index,
        message: `'${term}'은 객관적으로 입증하기 어려운 효능 표현입니다. 사용할 수 없습니다.`,
        conflictWith: term,
      })
    }
    for (const term of findTerms(textKey, rules.bannedTerms.competitorBrand)) {
      push({
        code: 'KW_COMPETITOR_BRAND',
        severity: 'ERROR',
        keywordIndex: index,
        message: `'${term}'은 경쟁 브랜드입니다. 검색어로 등록할 수 없습니다.`,
        conflictWith: term,
      })
    }
  })

  const cleaned = entries.filter((e) => !flagged.has(e.index)).map((e) => e.raw)
  const overflow = entries.slice(rules.maxKeywords).map((e) => e.raw)

  return { violations, cleaned, overflow }
}

export type ListingNamingResult = {
  searchName: NameValidationResult
  /** 노출용을 주지 않았으면 null */
  displayName: NameValidationResult | null
  keywords: KeywordValidationResult
  hasError: boolean
}

export function validateListingNaming(input: {
  searchName: string
  displayName?: string
  keywords: string[]
  categoryNames?: string[]
  optionNames?: string[]
  rules: KeywordRuleSet
}): ListingNamingResult {
  const searchName = validateProductName(
    input.searchName,
    rulesForNameField(input.rules, 'searchName')
  )
  // 노출용은 길이·금지어·특수문자만 본다. 검색어 중복 판정의 기준은 검색용이다(§10 Rule 1).
  const displayName = input.displayName?.trim()
    ? validateProductName(input.displayName, rulesForNameField(input.rules, 'displayName'))
    : null
  const keywords = validateKeywords({
    keywords: input.keywords,
    productName: input.searchName,
    categoryNames: input.categoryNames,
    optionNames: input.optionNames,
    rules: input.rules,
  })
  const hasError =
    searchName.violations.some((v) => v.severity === 'ERROR') ||
    (displayName?.violations.some((v) => v.severity === 'ERROR') ?? false) ||
    keywords.violations.some((v) => v.severity === 'ERROR')
  return { searchName, displayName, keywords, hasError }
}

// INFO 는 "안내"다(NameValidationPanel 도 같은 항목을 안내로 표기한다) — 저장 시 "규칙 위반"
// 토스트에 세면 목표 구간 미만(예: 40자 미만) 상품명마다 오경보가 뜬다. ERROR/WARN만 위반으로 센다.
const isCountableViolation = (v: Violation): boolean => v.severity !== 'INFO'

/**
 * 사용자가 고쳐야 할 실제 문제 개수.
 *
 * 노출용을 비우면 저장 시 검색용으로 채워진다(listings 라우트의 normalizeDisplayName).
 * 그러면 같은 문자열이 두 번 검증돼 같은 위반이 두 번 나오고, 그대로 합산하면 사용자가
 * 문제 1개를 2개로 본다. 그래서 두 이름이 같을 때는 노출용을 세지 않는다.
 *
 * 검증 자체를 건너뛰지 않는 이유: 폴백된 노출용도 실제로 저장되는 값이라, 채널의 노출용
 * 상한이 검색용보다 엄격해지면 진짜 위반을 놓친다. 세는 단계에서만 정리한다.
 */
export function countNamingViolations(
  result: ListingNamingResult,
  names: { searchName: string; displayName: string }
): number {
  const mirrors = names.displayName.trim() === names.searchName.trim()
  const count = (violations: Violation[]) => violations.filter(isCountableViolation).length
  return (
    count(result.searchName.violations) +
    (mirrors ? 0 : count(result.displayName?.violations ?? [])) +
    count(result.keywords.violations)
  )
}

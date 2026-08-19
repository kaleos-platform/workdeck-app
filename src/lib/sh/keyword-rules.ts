// 쿠팡 상품명·검색어 규칙 값 — `docs/쿠팡 상품명 및 검색어 운영 가이드.md` 기준.
// 값의 출처는 각 필드에 가이드 §번호로 남긴다.

export type BannedTerms = {
  /** §8.2 프로모션 문구 */
  promo: string[]
  /** §19 배송 관련 */
  shipping: string[]
  /** §8.3 판매자 이름 */
  seller: string[]
  /** §19 검증하기 어려운 효능 */
  efficacy: string[]
  /** §8.5 §19 경쟁 브랜드 — 기본 빈 배열(사용자가 워크스페이스별로 관리) */
  competitorBrand: string[]
}

export type KeywordRuleSet = {
  /** §10 검색어 최대 20개 */
  maxKeywords: number
  /** §7 목표 40~70자 */
  nameTargetMin: number
  nameTargetMax: number
  /** §7 권장 최대 80자 */
  nameSoftMax: number
  /** §7 절대 운영 상한 120자 */
  nameHardMax: number
  bannedTerms: BannedTerms
  /** §8.4 하드 금지 — 장식용 특수문자만. 대괄호·소괄호·+·/ 는 정상 상품명에 쓰이므로 제외. */
  specialCharPattern: RegExp
  /** 일반 특수문자(괄호·+·! 등) 개수 임계. 초과하면 경고. */
  specialCharSoftLimit: number
  /** 채널별 상품명 글자수 상한(검색용/노출용). 채널을 모르면 빈 객체. */
  channelLimits: ChannelNameLimits
}

/** 채널별 상품명 글자수 가이드. channel-name-limits.ts 에서 흡수했다. */
export type ChannelNameLimits = {
  searchName?: number
  displayName?: number
}

export type ChannelIdentity = {
  name: string
  externalSource: string | null
}

// §8.4 예시가 ★ ♥ 처럼 "장식" 목적의 기호를 문제 삼으므로 그 계열만 하드 금지한다.
// g 플래그를 붙이면 .test() 가 lastIndex 를 물고 상태를 갖게 되므로 붙이지 않는다.
const DECORATIVE_CHARS = /[★☆♥♡◆◇■□▶◀▲▼※○●◎♠♣→←↔『』【】]/

export const COUPANG_KEYWORD_RULES: KeywordRuleSet = {
  maxKeywords: 20,
  nameTargetMin: 40,
  nameTargetMax: 70,
  nameSoftMax: 80,
  nameHardMax: 120,
  bannedTerms: {
    // §8.2 목록 그대로
    promo: [
      '무료배송',
      '특가',
      '할인',
      '세일',
      '최저가',
      '대박특가',
      '인기상품',
      '신상품',
      '1+1',
      'best',
      '강력추천',
    ],
    // §19 배송 관련
    shipping: ['무료배송', '빠른배송', '당일배송', '로켓배송', '무료 반품'],
    // §8.3 판매자 이름 — 상호 자체는 알 수 없으므로 "판매자성 수식어"만 잡는다
    seller: ['판매자직접배송', '스토어인기상품', '마켓추천', '본사직영'],
    // §19 검증하기 어려운 효능
    efficacy: ['피부병예방', '질병예방', '간에좋은', '치료', '다이어트효과', '항암', '아토피치료'],
    competitorBrand: [],
  },
  specialCharPattern: DECORATIVE_CHARS,
  specialCharSoftLimit: 3,
  // 기본 상수는 채널 무관 — 채널 상한은 withChannelDefaults 로 얹는다.
  channelLimits: {},
}

export const DEFAULT_KEYWORD_RULES: KeywordRuleSet = COUPANG_KEYWORD_RULES

// 쿠팡은 가이드 §7 이 출처라 120 을 쓴다(구 channel-name-limits 의 100 은 출처 불명이라 버린다).
// 나머지는 각 채널 공지 기준. 채널명 부분일치로 찾는다 — 사용자가 "쿠팡 로켓그로스"처럼 접두어를 붙인다.
const CHANNEL_LIMITS: Array<{ keyword: string; limits: ChannelNameLimits }> = [
  { keyword: '쿠팡', limits: { searchName: 120, displayName: 120 } },
  { keyword: '스마트스토어', limits: { searchName: 50, displayName: 50 } },
  { keyword: '네이버', limits: { searchName: 50, displayName: 50 } },
  { keyword: '29cm', limits: { searchName: 40, displayName: 40 } },
  { keyword: '무신사', limits: { searchName: 30, displayName: 40 } },
  { keyword: '에이블리', limits: { searchName: 40, displayName: 40 } },
  { keyword: '지그재그', limits: { searchName: 40, displayName: 40 } },
  { keyword: '오늘의집', limits: { searchName: 40, displayName: 40 } },
]

function lookupChannelLimits(channel: ChannelIdentity | null): ChannelNameLimits {
  if (!channel) return {}
  const lower = channel.name.toLowerCase()
  for (const entry of CHANNEL_LIMITS) {
    if (lower.includes(entry.keyword)) return entry.limits
  }
  return {}
}

/**
 * 채널 상한을 규칙셋에 얹는다. 채널을 모르면(또는 등록되지 않은 채널이면) 원본 그대로.
 *
 * resolveKeywordRules 의 시그니처는 그대로 둔다(DB 오버라이드 병합만 담당) — 채널 상한은
 * 별도 단계로 합성해 기존 호출부·테스트의 회귀 범위를 좁힌다.
 */
export function withChannelDefaults(
  rules: KeywordRuleSet,
  channel: ChannelIdentity | null
): KeywordRuleSet {
  const channelLimits = lookupChannelLimits(channel)
  if (Object.keys(channelLimits).length === 0) return rules
  return { ...rules, channelLimits }
}

export type NameField = 'searchName' | 'displayName'

/**
 * 필드 상한에서 목표 구간을 다시 파생한 규칙셋.
 *
 * 채널 상한이 30자인데 목표를 40~70 으로 고정하면 사용자에게 상반된 지시가 뜬다.
 * 상한이 없으면 원본을 그대로 돌려준다.
 */
export function rulesForNameField(rules: KeywordRuleSet, field: NameField): KeywordRuleSet {
  const limit = rules.channelLimits[field]
  if (!limit) return rules
  return {
    ...rules,
    nameHardMax: limit,
    nameSoftMax: Math.min(rules.nameSoftMax, limit),
    nameTargetMax: Math.min(rules.nameTargetMax, limit),
    nameTargetMin: Math.min(rules.nameTargetMin, Math.floor(limit * 0.6)),
  }
}

export type KeywordRuleOverride = {
  maxKeywords?: number | null
  nameTargetMin?: number | null
  nameTargetMax?: number | null
  nameSoftMax?: number | null
  nameHardMax?: number | null
  bannedTerms?: Partial<BannedTerms> | null
  /** true = 기본 금지어를 대체, false/미지정 = 기본 금지어와 합집합 */
  replaceDefaultTerms?: boolean | null
}

const TERM_KEYS: (keyof BannedTerms)[] = [
  'promo',
  'shipping',
  'seller',
  'efficacy',
  'competitorBrand',
]

function cloneTerms(src: BannedTerms): BannedTerms {
  return {
    promo: [...src.promo],
    shipping: [...src.shipping],
    seller: [...src.seller],
    efficacy: [...src.efficacy],
    competitorBrand: [...src.competitorBrand],
  }
}

function mergeTermList(base: string[], extra: string[] | undefined, replace: boolean): string[] {
  if (!extra) return [...base]
  if (replace) return dedupe(extra)
  return dedupe([...base, ...extra])
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const term = String(raw ?? '').trim()
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}

/**
 * DB 오버라이드 병합. row 가 null/undefined 면 기본값 그대로.
 * non-null 필드만 덮어쓴다. bannedTerms 는 replaceDefaultTerms 로 대체/합집합을 고른다.
 *
 * DEFAULT_KEYWORD_RULES 는 COUPANG_KEYWORD_RULES 와 같은 참조라, 배열을 그대로 물려주면
 * 호출부가 push 하는 순간 모듈 싱글턴이 오염된다. 항상 새 객체·새 배열을 만든다.
 */
export function resolveKeywordRules(row: KeywordRuleOverride | null | undefined): KeywordRuleSet {
  const base = DEFAULT_KEYWORD_RULES
  if (!row) {
    return { ...base, bannedTerms: cloneTerms(base.bannedTerms) }
  }

  const replace = row.replaceDefaultTerms === true
  const terms = cloneTerms(base.bannedTerms)
  if (row.bannedTerms) {
    for (const key of TERM_KEYS) {
      terms[key] = mergeTermList(base.bannedTerms[key], row.bannedTerms[key], replace)
    }
  }

  return {
    ...base,
    maxKeywords: row.maxKeywords ?? base.maxKeywords,
    nameTargetMin: row.nameTargetMin ?? base.nameTargetMin,
    nameTargetMax: row.nameTargetMax ?? base.nameTargetMax,
    nameSoftMax: row.nameSoftMax ?? base.nameSoftMax,
    nameHardMax: row.nameHardMax ?? base.nameHardMax,
    bannedTerms: terms,
  }
}

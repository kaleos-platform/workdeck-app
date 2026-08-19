import { tokenizeProductName } from '@/lib/inv/search-tokens'
import { DEFAULT_KEYWORD_RULES, resolveKeywordRules } from '../keyword-rules'
import {
  validateKeywords,
  validateListingNaming,
  validateProductName,
  type Violation,
  type ViolationCode,
} from '../keyword-validate'

const rules = DEFAULT_KEYWORD_RULES

const codesAt = (violations: Violation[], index: number | null): ViolationCode[] =>
  violations.filter((v) => v.keywordIndex === index).map((v) => v.code)

const hasCode = (violations: Violation[], index: number, code: ViolationCode): boolean =>
  codesAt(violations, index).includes(code)

// 길이 구간 테스트용 — 단일 토큰이라 반복/금지어 위반이 섞이지 않는다.
const nameOfLength = (n: number): string => '가'.repeat(n)

describe('validateProductName — §8.1 키워드 반복', () => {
  it('나쁜 예: 같은 단어가 반복되면 NAME_REPEATED_TOKEN', () => {
    const r = validateProductName('여성 팬티 모달 팬티 여성 속옷 팬티', rules)
    const repeated = r.violations.filter((v) => v.code === 'NAME_REPEATED_TOKEN')
    expect(repeated.map((v) => v.conflictWith).sort()).toEqual(['여성', '팬티'])
    expect(repeated.find((v) => v.conflictWith === '팬티')?.message).toContain('3번')
  })

  it('좋은 예: 반복 위반 없음', () => {
    const r = validateProductName('여성 텐셀 모달 미디 팬티 3매', rules)
    expect(r.violations.filter((v) => v.code === 'NAME_REPEATED_TOKEN')).toHaveLength(0)
  })

  it('tokenizeProductName 은 중복을 지워 반복이 보이지 않는다 (별도 분해가 필요한 이유)', () => {
    expect(tokenizeProductName('여성 팬티 모달 팬티 여성 속옷 팬티')).toEqual([
      '여성',
      '팬티',
      '모달',
      '속옷',
    ])
  })
})

describe('validateProductName — §7 길이 4구간', () => {
  it('40자 미만 → NAME_BELOW_TARGET (INFO)', () => {
    const r = validateProductName(nameOfLength(30), rules)
    expect(r.length).toBe(30)
    const v = r.violations.find((x) => x.code === 'NAME_BELOW_TARGET')
    expect(v?.severity).toBe('INFO')
  })

  it('40~70자 → 길이 위반 없음', () => {
    const r = validateProductName(nameOfLength(55), rules)
    expect(r.violations.filter((x) => x.code.startsWith('NAME_'))).toHaveLength(0)
  })

  it('70자 초과 80자 이하 → NAME_ABOVE_TARGET (INFO)', () => {
    const r = validateProductName(nameOfLength(75), rules)
    expect(codesAt(r.violations, null)).toContain('NAME_ABOVE_TARGET')
    expect(r.violations.find((x) => x.code === 'NAME_ABOVE_TARGET')?.severity).toBe('INFO')
  })

  it('80자 초과 → NAME_ABOVE_SOFT_MAX (WARN)', () => {
    const r = validateProductName(nameOfLength(95), rules)
    const v = r.violations.find((x) => x.code === 'NAME_ABOVE_SOFT_MAX')
    expect(v?.severity).toBe('WARN')
    expect(codesAt(r.violations, null)).not.toContain('NAME_ABOVE_HARD_MAX')
  })

  it('120자 초과 → NAME_ABOVE_HARD_MAX (ERROR)', () => {
    const r = validateProductName(nameOfLength(130), rules)
    const v = r.violations.find((x) => x.code === 'NAME_ABOVE_HARD_MAX')
    expect(v?.severity).toBe('ERROR')
    expect(codesAt(r.violations, null)).not.toContain('NAME_ABOVE_SOFT_MAX')
  })

  it('극단적으로 짧으면 NAME_TOO_SHORT', () => {
    const r = validateProductName('타월', rules)
    expect(codesAt(r.violations, null)).toEqual(['NAME_TOO_SHORT'])
  })
})

describe('validateProductName — §8.2 §8.3 §8.4 §8.5', () => {
  it('프로모션·배송 문구는 WARN (오탐 가능하므로 무시 가능)', () => {
    const r = validateProductName('모노홈 무료배송 특가 호텔 타월 200g 5장', rules)
    const promo = r.violations.filter((x) => x.code === 'NAME_PROMO_TERM')
    expect(promo.map((v) => v.conflictWith).sort()).toEqual(['무료배송', '특가'])
    expect(promo.every((v) => v.severity === 'WARN')).toBe(true)
  })

  it('띄어 쓴 회피형도 잡는다', () => {
    const r = validateProductName('모노홈 무료 배송 호텔 타월 200g 5장', rules)
    expect(codesAt(r.violations, null)).toContain('NAME_PROMO_TERM')
  })

  it('장식용 특수문자 → NAME_SPECIAL_CHARS', () => {
    const r = validateProductName('★특가★ 모노홈 호텔 타월 200g 5장', rules)
    expect(codesAt(r.violations, null)).toContain('NAME_SPECIAL_CHARS')
  })

  it('일반 괄호는 임계 이하면 통과한다', () => {
    const r = validateProductName('모노홈 40수 코마사 호텔 타월 200g (5장)', rules)
    expect(codesAt(r.violations, null)).not.toContain('NAME_SPECIAL_CHARS')
  })

  it('경쟁 브랜드는 ERROR (사용자 등록 목록 기준)', () => {
    const custom = resolveKeywordRules({ bannedTerms: { competitorBrand: ['나이키'] } })
    const r = validateProductName('나이키 스타일 운동화 남성 데일리 러닝화', custom)
    const v = r.violations.find((x) => x.code === 'NAME_COMPETITOR_BRAND')
    expect(v?.severity).toBe('ERROR')
  })
})

// §9 — 잘못된 방식 / 올바른 방식이 한 쌍의 오라클이다.
describe('validateKeywords — §9 §10 상품명 중복', () => {
  const productName = '모노홈 40수 코마사 호텔 타월 200g 5장'

  it('잘못된 방식의 검색어는 전부 KW_DUP_WITH_NAME', () => {
    const keywords = [
      '모노홈',
      '40수',
      '코마사',
      '호텔',
      '타월',
      '200g',
      '5장',
      '호텔 타월',
      '호텔타월',
      '40수 타월',
      '코마사 타월',
    ]
    const r = validateKeywords({ keywords, productName, rules })
    keywords.forEach((_, i) => {
      expect(hasCode(r.violations, i, 'KW_DUP_WITH_NAME')).toBe(true)
    })
    expect(r.cleaned).toEqual([])
  })

  it('올바른 방식의 검색어는 위반 없음', () => {
    const keywords = [
      '세면 수건',
      '욕실 수건',
      '두꺼운 수건',
      '답례품 수건',
      '페이스 타월',
      '데일리 수건',
    ]
    const r = validateKeywords({ keywords, productName, rules })
    expect(r.violations).toEqual([])
    expect(r.cleaned).toEqual(keywords)
  })

  it('conflictWith 에 겹친 상품명 토큰을 담는다', () => {
    const r = validateKeywords({ keywords: ['40수 타월'], productName, rules })
    expect(r.violations[0].conflictWith).toBe('40수 타월')
  })

  it('띄어쓰기를 붙인 변형도 상품명 중복으로 잡는다', () => {
    const r = validateKeywords({ keywords: ['호텔타월'], productName, rules })
    expect(hasCode(r.violations, 0, 'KW_DUP_WITH_NAME')).toBe(true)
  })
})

describe('validateKeywords — 회귀: 상품명 13번째 이후 토큰', () => {
  // 40~70자 한국어 상품명은 12토큰을 쉽게 넘는다. tokenizeProductName 기본 상한(12)으로
  // 자르면 13번째 이후 단어와 겹치는 검색어가 검증을 통과해버린다.
  const productName =
    '모노홈 프리미엄 40수 코마사 호텔 타월 200g 5장 세면 욕실 데일리 대형 흡수력 도톰한 순면'

  it('기본 토큰 상한은 12개라 13번째 이후 단어가 빠진다', () => {
    const capped = tokenizeProductName(productName)
    expect(capped).toHaveLength(12)
    expect(capped).not.toContain('흡수력')
    expect(capped).not.toContain('순면')

    const full = tokenizeProductName(productName, Number.POSITIVE_INFINITY)
    expect(full).toContain('흡수력')
    expect(full).toContain('순면')
  })

  it('13번째 이후 단어로만 이뤄진 검색어도 KW_DUP_WITH_NAME 으로 잡힌다', () => {
    // 상품명에서 서로 떨어져 있어 despaced 부분문자열로는 걸리지 않는다 → 토큰 비교가 유일한 근거
    const r = validateKeywords({ keywords: ['순면 흡수력'], productName, rules })
    expect(hasCode(r.violations, 0, 'KW_DUP_WITH_NAME')).toBe(true)
  })
})

describe('validateKeywords — §11 띄어쓰기 중복', () => {
  it('나중에 등장한 변형만 표시한다', () => {
    const r = validateKeywords({
      keywords: ['호텔 타월', '호텔타월'],
      productName: '모노홈 코마사 수건 200g 5장',
      rules,
    })
    expect(codesAt(r.violations, 0)).toEqual([])
    expect(codesAt(r.violations, 1)).toEqual(['KW_DUP_SPACING_VARIANT'])
    expect(r.violations[0].conflictWith).toBe('호텔 타월')
    // 먼저 등록한 쪽은 살아남아야 "규칙 위반 정리"가 키워드를 통째로 지우지 않는다
    expect(r.cleaned).toEqual(['호텔 타월'])
  })
})

describe('validateKeywords — §12 단어 순서 조합 반복', () => {
  const keywords = [
    '여성 속옷',
    '여성 모달 속옷',
    '모달 여성 속옷',
    '여성 편한 속옷',
    '편한 여성 속옷',
  ]

  it('순열인 2건만 KW_DUP_PERMUTATION', () => {
    const r = validateKeywords({
      keywords,
      productName: '모노웨어 텐셀 미디 팬티 3매',
      rules,
    })
    const perms = r.violations.filter((v) => v.code === 'KW_DUP_PERMUTATION')
    expect(perms.map((v) => v.keywordIndex)).toEqual([2, 4])
    expect(perms[0].conflictWith).toBe('여성 모달 속옷')
    // '여성 속옷'은 3단어 조합의 순열이 아니다
    expect(codesAt(r.violations, 0)).toEqual([])
    expect(r.cleaned).toEqual(['여성 속옷', '여성 모달 속옷', '여성 편한 속옷'])
  })
})

describe('validateKeywords — 완전 동일 중복', () => {
  it('KW_DUP_EXACT 는 뒤에 온 것만 표시하고 앞의 것은 cleaned 에 남는다', () => {
    const r = validateKeywords({
      keywords: ['세면 수건', '세면  수건'],
      productName: '모노홈 코마사 타월',
      rules,
    })
    expect(codesAt(r.violations, 0)).toEqual([])
    expect(codesAt(r.violations, 1)).toEqual(['KW_DUP_EXACT'])
    expect(r.cleaned).toEqual(['세면 수건'])
  })
})

describe('validateKeywords — §19 금지 규칙', () => {
  const productName = '라이프랩 초경량 자동 골프 장우산 대형 120cm'

  it('배송 표현 → KW_SHIPPING_TERM (WARN)', () => {
    const r = validateKeywords({ keywords: ['무료배송', '당일배송'], productName, rules })
    expect(codesAt(r.violations, 0)).toContain('KW_SHIPPING_TERM')
    expect(codesAt(r.violations, 1)).toContain('KW_SHIPPING_TERM')
    expect(r.violations.every((v) => v.severity === 'WARN')).toBe(true)
  })

  it('효능 표현 → KW_EFFICACY_TERM (ERROR)', () => {
    const r = validateKeywords({ keywords: ['다이어트 효과', '질병 예방'], productName, rules })
    expect(r.violations.filter((v) => v.code === 'KW_EFFICACY_TERM')).toHaveLength(2)
    expect(r.violations.every((v) => v.severity === 'ERROR')).toBe(true)
  })

  it('경쟁 브랜드 → KW_COMPETITOR_BRAND (ERROR)', () => {
    const custom = resolveKeywordRules({ bannedTerms: { competitorBrand: ['나이키', '아디다스'] } })
    const r = validateKeywords({ keywords: ['나이키 우산'], productName, rules: custom })
    const v = r.violations.find((x) => x.code === 'KW_COMPETITOR_BRAND')
    expect(v?.severity).toBe('ERROR')
  })

  it('상품과 다른 속성(장우산 vs 3단 우산)은 규칙으로 판정할 수 없다 — 현재 동작을 고정', () => {
    // §19 의 이 케이스는 상품 사실(fact)을 알아야 판정 가능하므로 scoreKeyword 의
    // partialRelevanceOnly/exactMatch(사람 입력)로 다룬다. 검증기는 통과시킨다.
    const r = validateKeywords({ keywords: ['3단 우산'], productName, rules })
    expect(r.violations).toEqual([])
  })
})

describe('validateKeywords — §10 개수 상한 / §22 STEP08', () => {
  it('20개를 넘으면 초과분에 KW_OVER_LIMIT + overflow', () => {
    const keywords = Array.from({ length: 22 }, (_, i) => `키워드${i}`)
    const r = validateKeywords({ keywords, productName: '모노홈 타월 200g 5장', rules })
    const over = r.violations.filter((v) => v.code === 'KW_OVER_LIMIT')
    expect(over.map((v) => v.keywordIndex)).toEqual([20, 21])
    expect(over.every((v) => v.severity === 'WARN')).toBe(true)
    expect(r.overflow).toEqual(['키워드20', '키워드21'])
    expect(r.cleaned).toHaveLength(20)
  })

  it('빈 행이 섞여 있어도 20개까지는 초과로 보지 않는다', () => {
    // 편집 화면은 빈 행을 남긴다. 배열 인덱스로 세면 20번째 정상 검색어가 초과로 몰려
    // "규칙 위반 정리"가 멀쩡한 검색어를 지운다.
    const keywords = ['', ...Array.from({ length: 20 }, (_, i) => `키워드${i}`)]
    const r = validateKeywords({ keywords, productName: '모노홈 타월 200g 5장', rules })
    expect(r.violations.filter((v) => v.code === 'KW_OVER_LIMIT')).toEqual([])
    expect(r.overflow).toEqual([])
    expect(r.cleaned).toHaveLength(20)
  })

  it('빈 행을 제외한 21번째부터 초과로 본다', () => {
    const keywords = ['', ...Array.from({ length: 21 }, (_, i) => `키워드${i}`)]
    const r = validateKeywords({ keywords, productName: '모노홈 타월 200g 5장', rules })
    const over = r.violations.filter((v) => v.code === 'KW_OVER_LIMIT')
    expect(over).toHaveLength(1)
    expect(over[0].keywordIndex).toBe(21) // 원본 배열 인덱스를 그대로 돌려준다
    expect(r.overflow).toEqual(['키워드20'])
  })

  it('카테고리와 단순 중복 → KW_DUP_WITH_CATEGORY', () => {
    const r = validateKeywords({
      keywords: ['여성의류'],
      productName: '모노웨어 텐셀 모달 미디 팬티 3매',
      categoryNames: ['여성의류'],
      rules,
    })
    expect(codesAt(r.violations, 0)).toEqual(['KW_DUP_WITH_CATEGORY'])
  })

  it('구매옵션과 중복도 같은 코드로 알리되 메시지로 구분한다', () => {
    const r = validateKeywords({
      keywords: ['블랙'],
      productName: '모노웨어 텐셀 모달 미디 팬티 3매',
      optionNames: ['블랙', 'M'],
      rules,
    })
    expect(codesAt(r.violations, 0)).toEqual(['KW_DUP_WITH_CATEGORY'])
    expect(r.violations[0].message).toContain('구매옵션')
  })

  it('빈 검색어는 무시한다', () => {
    const r = validateKeywords({
      keywords: ['세면 수건', '', '   '],
      productName: '모노홈 코마사 타월',
      rules,
    })
    expect(r.violations).toEqual([])
    expect(r.cleaned).toEqual(['세면 수건'])
  })

  it('지나치게 긴 검색어 → KW_TOO_LONG', () => {
    const r = validateKeywords({
      keywords: ['아주 부드럽고 도톰한 데일리 세면 수건 대형 사이즈'],
      productName: '모노홈 코마사 타월',
      rules,
    })
    expect(codesAt(r.violations, 0)).toContain('KW_TOO_LONG')
  })
})

describe('validateListingNaming', () => {
  it('ERROR 가 하나라도 있으면 hasError', () => {
    const r = validateListingNaming({
      searchName: '모노홈 40수 코마사 호텔 타월 200g 5장',
      keywords: ['다이어트 효과'],
      rules,
    })
    expect(r.hasError).toBe(true)
  })

  it('WARN/INFO 만 있으면 hasError=false', () => {
    const r = validateListingNaming({
      searchName: '모노홈 40수 코마사 호텔 타월 200g 5장',
      keywords: ['세면 수건', '욕실 수건'],
      rules,
    })
    expect(r.hasError).toBe(false)
    expect(r.searchName.violations.map((v) => v.code)).toEqual(['NAME_BELOW_TARGET'])
    expect(r.keywords.cleaned).toEqual(['세면 수건', '욕실 수건'])
  })

  it('검색용·검색어를 함께 검증한다', () => {
    const r = validateListingNaming({
      searchName: '모노홈 40수 코마사 호텔 타월 200g 5장',
      keywords: ['호텔 타월'],
      rules,
    })
    expect(r.searchName.length).toBeGreaterThan(0)
    expect(r.keywords.violations.some((v) => v.code === 'KW_DUP_WITH_NAME')).toBe(true)
  })

  it('노출용을 주면 함께 검증한다', () => {
    const r = validateListingNaming({
      searchName: '모노홈 호텔 타월',
      displayName: '★특가★ 무료배송 타월',
      keywords: [],
      rules,
    })
    expect(r.displayName).not.toBeNull()
    expect(r.displayName!.violations.some((v) => v.code === 'NAME_SPECIAL_CHARS')).toBe(true)
    expect(r.displayName!.violations.some((v) => v.code === 'NAME_PROMO_TERM')).toBe(true)
  })

  it('노출용이 없으면 null', () => {
    const r = validateListingNaming({ searchName: '타월', keywords: [], rules })
    expect(r.displayName).toBeNull()
  })

  it('노출용은 검색어 중복 판정에 쓰이지 않는다', () => {
    // §10 Rule 1 의 대상은 검색에 쓰이는 이름이다.
    const r = validateListingNaming({
      searchName: '모노홈 타월',
      displayName: '호텔 세면 수건',
      keywords: ['세면 수건'],
      rules,
    })
    expect(r.keywords.violations.some((v) => v.code === 'KW_DUP_WITH_NAME')).toBe(false)
  })

  it('노출용 위반도 hasError 에 반영된다', () => {
    const long = 'x'.repeat(rules.nameHardMax + 1)
    const r = validateListingNaming({ searchName: '타월', displayName: long, keywords: [], rules })
    expect(r.hasError).toBe(true)
  })
})

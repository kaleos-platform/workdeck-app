import { keywordPriority, scoreKeyword, type KeywordScoreInputs } from '../keyword-score'

const base: KeywordScoreInputs = {
  exactMatch: false,
  purchaseIntent: false,
  inAutocomplete: false,
  inRelated: false,
  inReviews: false,
  overlapsProductName: false,
  overlapsCategory: false,
  partialRelevanceOnly: false,
  isCompetitorBrand: false,
  isFalseClaim: false,
}

const inputs = (over: Partial<KeywordScoreInputs>): KeywordScoreInputs => ({ ...base, ...over })

// §17 예시 표 5행
describe('scoreKeyword — §17 예시 표', () => {
  it('세면 수건: 관련성3 + 구매의도3 + 자동완성2 = 8 → 사용', () => {
    const r = scoreKeyword(inputs({ exactMatch: true, purchaseIntent: true, inAutocomplete: true }))
    expect(r.score).toBe(8)
    expect(r.decision).toBe('USE')
  })

  it('호텔 타월: 6점이지만 상품명에 있으므로 제외', () => {
    const r = scoreKeyword(
      inputs({
        exactMatch: true,
        purchaseIntent: true,
        inAutocomplete: true,
        overlapsProductName: true,
      })
    )
    expect(r.score).toBe(6)
    expect(r.decision).toBe('EXCLUDE')
    expect(r.reasons).toContain('상품명에 이미 있으므로 제외')
  })

  it('극세사 수건: 관련성 0 → 점수와 무관하게 제외', () => {
    const r = scoreKeyword(inputs({ purchaseIntent: true, inAutocomplete: true }))
    expect(r.score).toBe(5)
    expect(r.decision).toBe('EXCLUDE')
    expect(r.reasons).toContain('상품과 관련성이 확인되지 않아 제외')
  })

  it('답례품 수건: 부분 관련 + 구매의도 + 자동완성 + 연관검색 = 5 → 후보', () => {
    // §15 연관검색어 목록에 '답례품수건'이 있다.
    const r = scoreKeyword(
      inputs({
        purchaseIntent: true,
        inAutocomplete: true,
        inRelated: true,
        partialRelevanceOnly: true,
      })
    )
    expect(r.score).toBe(5)
    expect(r.decision).toBe('CANDIDATE')
  })

  it('OO브랜드 수건: 경쟁 브랜드 → 점수 무관 금지', () => {
    const r = scoreKeyword(
      inputs({ exactMatch: true, purchaseIntent: true, isCompetitorBrand: true })
    )
    expect(r.decision).toBe('BANNED')
  })
})

describe('scoreKeyword — 캐스케이드 순서', () => {
  it('경쟁 브랜드는 상품명 중복보다 먼저 판정된다', () => {
    const r = scoreKeyword(inputs({ overlapsProductName: true, isCompetitorBrand: true }))
    expect(r.decision).toBe('BANNED')
  })

  it('허위 표현은 만점이어도 금지', () => {
    const r = scoreKeyword(
      inputs({
        exactMatch: true,
        purchaseIntent: true,
        inAutocomplete: true,
        inRelated: true,
        inReviews: true,
        isFalseClaim: true,
      })
    )
    expect(r.score).toBe(11)
    expect(r.decision).toBe('BANNED')
  })

  it('관련은 있으나 점수가 낮으면 제외', () => {
    const r = scoreKeyword(inputs({ exactMatch: true, overlapsCategory: true }))
    expect(r.score).toBe(2)
    expect(r.decision).toBe('EXCLUDE')
  })
})

describe('keywordPriority — §18', () => {
  it('동의어 → 용도 → 소재/형태/특징 → 상위개념 → 별칭 순', () => {
    expect(keywordPriority('SYNONYM')).toBe(1)
    expect(keywordPriority('PURPOSE')).toBe(2)
    expect(keywordPriority('MATERIAL')).toBe(3)
    expect(keywordPriority('SHAPE')).toBe(3)
    expect(keywordPriority('FEATURE')).toBe(3)
    expect(keywordPriority('PARENT_CATEGORY')).toBe(4)
    expect(keywordPriority('ALIAS')).toBe(5)
  })

  it('경쟁 브랜드는 가장 후순위', () => {
    expect(keywordPriority('COMPETITOR')).toBeGreaterThan(keywordPriority('UNCLASSIFIED'))
  })
})

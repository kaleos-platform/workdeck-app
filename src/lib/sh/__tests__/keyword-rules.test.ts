import { COUPANG_KEYWORD_RULES, DEFAULT_KEYWORD_RULES, resolveKeywordRules } from '../keyword-rules'

describe('COUPANG_KEYWORD_RULES', () => {
  it('가이드 §7 §10 값을 그대로 담는다', () => {
    expect(COUPANG_KEYWORD_RULES.maxKeywords).toBe(20)
    expect(COUPANG_KEYWORD_RULES.nameTargetMin).toBe(40)
    expect(COUPANG_KEYWORD_RULES.nameTargetMax).toBe(70)
    expect(COUPANG_KEYWORD_RULES.nameSoftMax).toBe(80)
    expect(COUPANG_KEYWORD_RULES.nameHardMax).toBe(120)
  })

  it('경쟁 브랜드는 기본 빈 배열 (사용자가 관리)', () => {
    expect(COUPANG_KEYWORD_RULES.bannedTerms.competitorBrand).toEqual([])
  })

  it('specialCharPattern 에 g 플래그가 없다 (test() 가 상태를 갖지 않도록)', () => {
    expect(COUPANG_KEYWORD_RULES.specialCharPattern.global).toBe(false)
    expect(COUPANG_KEYWORD_RULES.specialCharPattern.test('★특가★')).toBe(true)
    expect(COUPANG_KEYWORD_RULES.specialCharPattern.test('★특가★')).toBe(true)
  })

  it('일반 대괄호·소괄호는 하드 금지가 아니다', () => {
    expect(COUPANG_KEYWORD_RULES.specialCharPattern.test('모노홈 타월 (3매)')).toBe(false)
  })
})

describe('resolveKeywordRules', () => {
  it('row 가 null 이면 기본값', () => {
    const r = resolveKeywordRules(null)
    expect(r.maxKeywords).toBe(DEFAULT_KEYWORD_RULES.maxKeywords)
    expect(r.bannedTerms.promo).toEqual(DEFAULT_KEYWORD_RULES.bannedTerms.promo)
  })

  it('row 가 undefined 여도 기본값', () => {
    expect(resolveKeywordRules(undefined).nameHardMax).toBe(120)
  })

  it('non-null 필드만 덮어쓴다', () => {
    const r = resolveKeywordRules({ maxKeywords: 10, nameSoftMax: null })
    expect(r.maxKeywords).toBe(10)
    expect(r.nameSoftMax).toBe(80)
    expect(r.nameTargetMin).toBe(40)
  })

  it('replaceDefaultTerms 미지정이면 기본 금지어와 합집합', () => {
    const r = resolveKeywordRules({ bannedTerms: { competitorBrand: ['나이키'] } })
    expect(r.bannedTerms.competitorBrand).toEqual(['나이키'])
    expect(r.bannedTerms.promo).toContain('특가')
  })

  it('replaceDefaultTerms=false 도 합집합', () => {
    const r = resolveKeywordRules({
      bannedTerms: { promo: ['한정판매'] },
      replaceDefaultTerms: false,
    })
    expect(r.bannedTerms.promo).toContain('특가')
    expect(r.bannedTerms.promo).toContain('한정판매')
  })

  it('replaceDefaultTerms=true 면 제공된 카테고리를 대체한다', () => {
    const r = resolveKeywordRules({
      bannedTerms: { promo: ['한정판매'] },
      replaceDefaultTerms: true,
    })
    expect(r.bannedTerms.promo).toEqual(['한정판매'])
    // 제공하지 않은 카테고리는 기본값 유지
    expect(r.bannedTerms.shipping).toContain('무료배송')
  })

  it('반환값의 배열을 변형해도 모듈 기본값이 오염되지 않는다', () => {
    const r = resolveKeywordRules(null)
    r.bannedTerms.promo.push('오염')
    expect(DEFAULT_KEYWORD_RULES.bannedTerms.promo).not.toContain('오염')
    expect(resolveKeywordRules(null).bannedTerms.promo).not.toContain('오염')
  })
})

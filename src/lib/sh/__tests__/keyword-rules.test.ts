import {
  COUPANG_KEYWORD_RULES,
  DEFAULT_KEYWORD_RULES,
  resolveKeywordRules,
  withChannelDefaults,
  rulesForNameField,
} from '../keyword-rules'

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

describe('withChannelDefaults', () => {
  it('쿠팡은 가이드 §7 값을 그대로 쓴다(채널 상한도 120)', () => {
    const r = withChannelDefaults(resolveKeywordRules(null), {
      name: '쿠팡 로켓그로스',
      externalSource: null,
    })
    expect(r.nameTargetMin).toBe(40)
    expect(r.nameTargetMax).toBe(70)
    expect(r.nameSoftMax).toBe(80)
    expect(r.nameHardMax).toBe(120)
    expect(r.channelLimits.searchName).toBe(120)
  })

  it('무신사는 검색용 30·노출용 40', () => {
    const r = withChannelDefaults(resolveKeywordRules(null), {
      name: '무신사',
      externalSource: null,
    })
    expect(r.channelLimits.searchName).toBe(30)
    expect(r.channelLimits.displayName).toBe(40)
  })

  it('등록되지 않은 채널은 기본값(빈 channelLimits)', () => {
    const r = withChannelDefaults(resolveKeywordRules(null), {
      name: '자사몰',
      externalSource: null,
    })
    expect(r.nameHardMax).toBe(DEFAULT_KEYWORD_RULES.nameHardMax)
    expect(r.channelLimits.searchName).toBeUndefined()
  })

  it('채널이 null 이면 원본 그대로', () => {
    const base = resolveKeywordRules(null)
    expect(withChannelDefaults(base, null)).toBe(base)
  })

  it('DB 오버라이드가 병합된 규칙 위에 채널 상한을 얹을 수 있다', () => {
    const r = withChannelDefaults(resolveKeywordRules({ maxKeywords: 10 }), {
      name: '무신사',
      externalSource: null,
    })
    expect(r.maxKeywords).toBe(10)
    expect(r.channelLimits.searchName).toBe(30)
  })

  it('반환된 channelLimits 를 변형해도 모듈 상수(CHANNEL_LIMITS)가 오염되지 않는다', () => {
    const r = withChannelDefaults(resolveKeywordRules(null), {
      name: '무신사',
      externalSource: null,
    })
    r.channelLimits.searchName = 999
    const again = withChannelDefaults(resolveKeywordRules(null), {
      name: '무신사',
      externalSource: null,
    })
    expect(again.channelLimits.searchName).toBe(30)
  })
})

describe('rulesForNameField', () => {
  it('검색용 상한에서 목표 구간을 파생한다', () => {
    const base = withChannelDefaults(resolveKeywordRules(null), {
      name: '무신사',
      externalSource: null,
    })
    const r = rulesForNameField(base, 'searchName')
    expect(r.nameHardMax).toBe(30)
    expect(r.nameSoftMax).toBe(30)
    expect(r.nameTargetMax).toBe(30)
    expect(r.nameTargetMin).toBe(18) // floor(30 * 0.6)
  })

  it('노출용은 노출용 상한을 쓴다', () => {
    const base = withChannelDefaults(resolveKeywordRules(null), {
      name: '무신사',
      externalSource: null,
    })
    const r = rulesForNameField(base, 'displayName')
    expect(r.nameHardMax).toBe(40)
    expect(r.nameTargetMin).toBe(24) // floor(40 * 0.6)
  })

  it('상한이 없으면 원본 그대로', () => {
    const base = resolveKeywordRules(null)
    expect(rulesForNameField(base, 'searchName')).toEqual(base)
  })

  it('목표 하한이 상한을 넘지 않는다 (대소문자 무관 매칭도 함께 검증)', () => {
    const base = withChannelDefaults(resolveKeywordRules(null), {
      name: '29CM',
      externalSource: null,
    })
    // '29cm' 키워드가 대문자 입력('29CM')에도 매칭되는지 확인한다.
    // 이 단언이 없으면 매칭이 깨져 channelLimits={} 여도 40<=70 이라 항상 통과해버린다.
    expect(base.channelLimits.searchName).toBe(40)
    const r = rulesForNameField(base, 'searchName')
    expect(r.nameTargetMin).toBeLessThanOrEqual(r.nameTargetMax)
  })
})

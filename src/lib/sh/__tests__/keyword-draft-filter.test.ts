import { filterDraftKeywords, type DraftKeywordCandidate } from '../keyword-draft-filter'
import { DEFAULT_KEYWORD_RULES } from '../keyword-rules'

const rules = DEFAULT_KEYWORD_RULES

// 상품명 토큰과 겹치지 않는 중립 후보 생성기 — 필터 대상이 아닌 통과분을 만들 때 쓴다.
const cand = (keyword: string, i = 0): DraftKeywordCandidate => ({
  keyword,
  intent: 'PURPOSE',
  reason: `사유${i}`,
})

const run = (args: {
  existing?: string[]
  candidates: DraftKeywordCandidate[]
  reviews?: {
    keyword: string
    label: Parameters<typeof filterDraftKeywords>[0]['reviews'][number]['label']
    reason: string
  }[]
  productName?: string
  categoryNames?: string[]
  optionNames?: string[]
  target?: number
}) =>
  filterDraftKeywords({
    existingKeywords: args.existing ?? [],
    candidates: args.candidates,
    reviews: args.reviews ?? [],
    productName: args.productName ?? '무쇠 프라이팬 28cm 인덕션 겸용',
    categoryNames: args.categoryNames,
    optionNames: args.optionNames,
    rules,
    target: args.target ?? 10,
  })

describe('filterDraftKeywords — 결정적 규칙 위반 후보를 버린다', () => {
  it('상품명 단어를 재사용한 후보는 드롭된다 (KW_DUP_WITH_NAME 은 WARN — severity 필터였다면 통과했을 것)', () => {
    const r = run({ candidates: [cand('무쇠 프라이팬'), cand('캠핑 조리도구')] })
    expect(r.keywords.map((k) => k.value)).toEqual(['캠핑 조리도구'])
  })

  it('등록 검색어와 완전 동일한 후보는 드롭되고, 등록분에는 위반이 붙지 않는다', () => {
    const r = run({ existing: ['밀프렙용기'], candidates: [cand('밀프렙용기'), cand('자취 살림')] })
    expect(r.keywords.map((k) => k.value)).toEqual(['자취 살림'])
    expect(r.reviews[0].violations).toHaveLength(0)
    expect(r.reviews[0].recommendRemove).toBe(false)
  })

  it('등록 검색어의 띄어쓰기 변형 후보는 드롭된다 (§11)', () => {
    const r = run({
      existing: ['밀프렙 용기'],
      candidates: [cand('밀프렙용기'), cand('자취 살림')],
    })
    expect(r.keywords.map((k) => k.value)).toEqual(['자취 살림'])
  })

  it('후보끼리 단어 순서만 다르면 뒤에 온 쪽만 드롭된다 (§12)', () => {
    const r = run({ candidates: [cand('캠핑 조리도구'), cand('조리도구 캠핑'), cand('자취 살림')] })
    expect(r.keywords.map((k) => k.value)).toEqual(['캠핑 조리도구', '자취 살림'])
  })

  it('배송·효능 표현은 드롭된다 (§19)', () => {
    const r = run({ candidates: [cand('무료배송'), cand('아토피치료'), cand('자취 살림')] })
    expect(r.keywords.map((k) => k.value)).toEqual(['자취 살림'])
  })

  it('25자를 넘는 후보는 드롭된다', () => {
    const r = run({ candidates: [cand('가'.repeat(26)), cand('자취 살림')] })
    expect(r.keywords.map((k) => k.value)).toEqual(['자취 살림'])
  })

  it('카테고리·구매옵션 토큰만으로 이루어진 후보는 드롭된다 (§22)', () => {
    const r = run({
      candidates: [cand('프라이팬'), cand('자취 살림')],
      categoryNames: ['프라이팬'],
    })
    expect(r.keywords.map((k) => k.value)).toEqual(['자취 살림'])
  })
})

describe('filterDraftKeywords — KW_OVER_LIMIT 함정', () => {
  // 등록 검색어를 maxKeywords 만큼 채우면 병합 배열에서 모든 후보의 위치가 상한을 넘는다.
  const existing = Array.from({ length: rules.maxKeywords }, (_, i) => `등록어${i}`)

  it('상한을 넘긴 위치라는 이유로 후보가 드롭되지 않는다', () => {
    const candidates = Array.from({ length: 24 }, (_, i) => cand(`후보어${i}`, i))
    const r = run({ existing, candidates, target: 10 })
    expect(r.keywords).toHaveLength(10)
  })

  it('후보에 붙여 내려보내는 violations 에는 KW_OVER_LIMIT 이 없다', () => {
    const candidates = Array.from({ length: 24 }, (_, i) => cand(`후보어${i}`, i))
    const r = run({ existing, candidates })
    expect(r.keywords.flatMap((k) => k.violations.map((v) => v.code))).not.toContain(
      'KW_OVER_LIMIT'
    )
  })

  it('상한을 넘긴 등록 검색어와 겹치는 후보도 중복으로 드롭된다 (프롬프트 상한과 무관해야 한다)', () => {
    // 등록 검색어 30개 중 28번째와 겹치는 후보. 라우트가 프롬프트용 상한(25)으로 자른 목록을
    // 필터에 넘기면 이 후보가 그대로 통과해 "이미 담긴 검색어"가 추천 자리를 차지한다.
    const many = Array.from({ length: 30 }, (_, i) => `등록어${i}`)
    const r = run({ existing: many, candidates: [cand('등록어27'), cand('자취 살림')] })
    expect(r.keywords.map((k) => k.value)).toEqual(['자취 살림'])
  })

  it('등록 검색어 쪽 KW_OVER_LIMIT 은 진짜 진단이므로 남는다', () => {
    const over = [...existing, '초과등록어']
    const r = run({ existing: over, candidates: [cand('자취 살림')] })
    const last = r.reviews[r.reviews.length - 1]
    expect(last.violations.map((v) => v.code)).toContain('KW_OVER_LIMIT')
    expect(last.recommendRemove).toBe(false) // KW_OVER_LIMIT 은 드롭 코드가 아니다
  })
})

describe('filterDraftKeywords — 절삭과 순서', () => {
  it('통과분이 target 을 넘으면 모델 순서 그대로 앞에서 자른다', () => {
    const candidates = Array.from({ length: 18 }, (_, i) => cand(`후보어${i}`, i))
    const r = run({ candidates, target: 10 })
    expect(r.keywords.map((k) => k.value)).toEqual(
      Array.from({ length: 10 }, (_, i) => `후보어${i}`)
    )
  })

  it('통과분이 target 미만이면 미만인 채로 내린다 (드롭분으로 채우지 않는다)', () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, i) => cand(`후보어${i}`, i)),
      cand('무쇠 프라이팬'),
      cand('무료배송'),
    ]
    const r = run({ candidates, target: 10 })
    expect(r.keywords).toHaveLength(6)
  })

  it('intentLabel 을 한국어로 붙인다', () => {
    const r = run({ candidates: [{ keyword: '자취 살림', intent: 'LONGTAIL', reason: 'ㅇㅇ' }] })
    expect(r.keywords[0].intentLabel).toBe('롱테일')
    expect(r.keywords[0].reason).toBe('ㅇㅇ')
  })
})

describe('filterDraftKeywords — 등록 검색어 진단', () => {
  it('AI 판정을 정규화 기준으로 조인한다', () => {
    const r = run({
      existing: ['자취 살림'],
      candidates: [],
      reviews: [{ keyword: '자취  살림', label: 'LOW_INTENT', reason: '정보 탐색성' }],
    })
    expect(r.reviews[0].label).toBe('LOW_INTENT')
    expect(r.reviews[0].labelText).toBe('구매의도 낮음')
    expect(r.reviews[0].recommendRemove).toBe(true)
  })

  it('판정이 없는 등록 검색어는 KEEP 으로 채운다', () => {
    const r = run({ existing: ['자취 살림'], candidates: [] })
    expect(r.reviews[0].label).toBe('KEEP')
    expect(r.reviews[0].recommendRemove).toBe(false)
  })

  it('AI 가 KEEP 이라 해도 결정적 위반이 있으면 제거를 권한다', () => {
    const r = run({
      existing: ['무료배송'],
      candidates: [],
      reviews: [{ keyword: '무료배송', label: 'KEEP', reason: '' }],
    })
    expect(r.reviews[0].recommendRemove).toBe(true)
  })

  it('등록분에 없는 키워드에 대한 판정은 결과에 나타나지 않는다', () => {
    const r = run({
      existing: ['자취 살림'],
      candidates: [],
      reviews: [{ keyword: '유령 키워드', label: 'FALSE_CLAIM', reason: '' }],
    })
    expect(r.reviews.map((x) => x.keyword)).toEqual(['자취 살림'])
  })

  it('빈 문자열 후보·등록어는 무시한다', () => {
    const r = run({ existing: ['', '  '], candidates: [cand(''), cand('자취 살림')] })
    expect(r.reviews).toHaveLength(0)
    expect(r.keywords.map((k) => k.value)).toEqual(['자취 살림'])
  })
})

describe('filterDraftKeywords — 상품명 복합어(§10 한국어)', () => {
  const productName = '에이엠엘 쿨 메쉬 심리스 커버 브라 노와이어 후크없이 편안한 중년 여성 속옷'

  it('상품명 단어가 섞인 후보는 전부 드롭된다 (새로 만들 때는 아예 안 쓴다)', () => {
    const r = run({
      candidates: [cand('노와이어브라'), cand('중년여성브라'), cand('티셔츠브라'), cand('티셔츠')],
      productName,
    })
    expect(r.keywords.map((k) => k.value)).toEqual(['티셔츠'])
  })

  it('등록 검색어에 제안이 붙으면 제거 권장이 아니라 suggestion 을 준다', () => {
    const r = run({ existing: ['여름브라'], candidates: [], productName })
    expect(r.reviews[0].suggestion).toBe('여름')
    expect(r.reviews[0].recommendRemove).toBe(false)
  })

  it('뺄 것이 없어 못 쓰는 검색어는 그대로 제거 권장', () => {
    const r = run({ existing: ['노와이어브라'], candidates: [], productName })
    expect(r.reviews[0].suggestion).toBeUndefined()
    expect(r.reviews[0].recommendRemove).toBe(true)
  })

  it('등록 검색어에 붙으면 제거를 권한다', () => {
    const r = run({
      existing: ['심리스브라', '티셔츠브라'],
      candidates: [],
      productName,
    })
    expect(r.reviews[0].recommendRemove).toBe(true)
    expect(r.reviews[0].violations.map((v) => v.code)).toContain('KW_NAME_COMPOUND')
    // 티셔츠브라는 '티셔츠' 로 고칠 수 있으므로 제거가 아니라 제안이다.
    expect(r.reviews[1].recommendRemove).toBe(false)
    expect(r.reviews[1].suggestion).toBe('티셔츠')
  })
})

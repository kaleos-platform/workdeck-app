import { DEFAULT_KEYWORD_RULES } from '../keyword-rules'
import {
  suggestKeywords,
  suggestKeywordsDetailed,
  type ProductContext,
  type SuggestPoolItem,
} from '../keyword-suggest'

const rules = DEFAULT_KEYWORD_RULES
const productName = '모노홈 40수 코마사 호텔 타월 200g 5장'

const item = (over: Partial<SuggestPoolItem> & { keyword: string }): SuggestPoolItem => ({
  type: 'FEATURE',
  score: 5,
  status: 'CANDIDATE',
  ...over,
})

describe('suggestKeywords', () => {
  it('풀이 비면 빈 배열 (Phase 2 이전의 정상 상태)', () => {
    expect(suggestKeywords({ productName, existing: [], masterPool: [], rules })).toEqual([])
  })

  it('상품명과 중복되는 표현·이미 등록된 표현·금지/제외 상태를 걸러낸다', () => {
    const result = suggestKeywords({
      productName,
      existing: ['세면 수건'],
      masterPool: [
        item({ keyword: '호텔 타월' }), // §10 상품명 중복
        item({ keyword: '호텔타월' }), // 띄어쓰기 변형도 상품명 중복
        item({ keyword: '세면 수건' }), // 이미 등록
        item({ keyword: 'A브랜드 수건', status: 'BANNED' }),
        item({ keyword: '극세사 수건', status: 'EXCLUDED' }),
        item({ keyword: '욕실 수건' }),
      ],
      rules,
    })
    expect(result).toEqual(['욕실 수건'])
  })

  it('점수 내림차순 → §18 우선순위 오름차순으로 정렬한다', () => {
    const result = suggestKeywords({
      productName,
      existing: [],
      masterPool: [
        item({ keyword: '수건', score: 5, type: 'ALIAS' }),
        item({ keyword: '데일리 수건', score: 8, type: 'PURPOSE' }),
        item({ keyword: '페이스 타월', score: 5, type: 'SYNONYM' }),
      ],
      rules,
    })
    expect(result).toEqual(['데일리 수건', '페이스 타월', '수건'])
  })

  it('남은 슬롯만큼만 돌려준다', () => {
    const existing = Array.from({ length: 19 }, (_, i) => `기존${i}`)
    const masterPool = Array.from({ length: 5 }, (_, i) => item({ keyword: `후보${i}` }))
    expect(suggestKeywords({ productName, existing, masterPool, rules })).toHaveLength(1)
  })

  it('회귀 가드 — productContext 없이 호출하면 기존 동작과 동일하다', () => {
    const masterPool = [
      item({ keyword: '수건', score: 5, type: 'ALIAS' }),
      item({ keyword: '데일리 수건', score: 8, type: 'PURPOSE' }),
      item({ keyword: '페이스 타월', score: 5, type: 'SYNONYM' }),
    ]
    const result = suggestKeywords({ productName, existing: [], masterPool, rules })
    // 기존(문맥 미도입) 테스트에서 캡처한 실제 출력값 — §18 우선순위 정렬 그대로
    expect(result).toEqual(['데일리 수건', '페이스 타월', '수건'])
  })

  it('문맥과 일치하는 풀 항목이 동점 항목보다 위로 정렬된다', () => {
    const productContext: ProductContext = {
      description: '호텔에서 쓰는 고급 원단 타월입니다',
      features: ['빠른 흡수력', '순면 100%'],
    }
    const masterPool = [
      item({ keyword: '순면 소재', score: 5, type: 'MATERIAL' }), // 문맥 일치 (features)
      item({ keyword: '욕실 매트', score: 5, type: 'MATERIAL' }), // 문맥 불일치, 동점
    ]
    const result = suggestKeywordsDetailed({
      productName,
      existing: [],
      masterPool,
      rules,
      productContext,
    })
    // 풀 항목 두 개가 채굴 후보보다 앞서고, 그중 문맥 일치 항목이 먼저 온다
    expect(result.slice(0, 2).map((r) => r.keyword)).toEqual(['순면 소재', '욕실 매트'])
    expect(result[0].origin).toBe('pool')
    expect(result[1].origin).toBe('pool')
  })

  it('풀이 부족하면 features 에서 후보를 채굴해 풀 항목 뒤에 덧붙인다(origin=context)', () => {
    const productContext: ProductContext = {
      features: ['초극세사 원단', '빠른건조'],
    }
    const masterPool = [item({ keyword: '욕실 수건', score: 5 })]
    const result = suggestKeywordsDetailed({
      productName,
      existing: [],
      masterPool,
      rules,
      productContext,
    })
    expect(result[0]).toEqual({ keyword: '욕실 수건', origin: 'pool' })
    expect(result.length).toBeGreaterThan(1)
    expect(result.slice(1).every((r) => r.origin === 'context')).toBe(true)
  })

  it('인증번호 원문은 절대 노출되지 않고, 인증 유형어(KC)만 문맥에 반영된다', () => {
    const productContext: ProductContext = {
      certifications: ['KC 인증번호 CB072R0012-24001'],
    }
    const masterPool = [
      item({ keyword: 'KC 인증', score: 5, type: 'FEATURE' }),
      item({ keyword: '기타 표현', score: 5, type: 'FEATURE' }),
    ]
    const result = suggestKeywordsDetailed({
      productName,
      existing: [],
      masterPool,
      rules,
      productContext,
    })
    expect(result.map((r) => r.keyword)).not.toContain('CB072R0012-24001')
    // 문맥 일치한 'KC 인증'이 가점을 받아 동점인 '기타 표현'보다 앞선다
    const kcIndex = result.findIndex((r) => r.keyword === 'KC 인증')
    const otherIndex = result.findIndex((r) => r.keyword === '기타 표현')
    expect(kcIndex).toBeLessThan(otherIndex)
  })

  it('문맥이 있어도 상품명과 중복되는 키워드는 여전히 걸러진다', () => {
    const productContext: ProductContext = {
      description: '호텔 타월 전용 세탁 안내',
    }
    const masterPool = [item({ keyword: '호텔 타월', score: 5 })]
    const result = suggestKeywordsDetailed({
      productName,
      existing: [],
      masterPool,
      rules,
      productContext,
    })
    expect(result).toEqual([])
  })

  it('결정론 — 동일 입력을 두 번 호출해도 동일한 배열을 반환한다', () => {
    const productContext: ProductContext = {
      description: '순면 소재 고급 타월',
      features: ['빠른건조', '흡수력 강화'],
      certifications: ['식약처 신고번호 12345'],
    }
    const masterPool = [
      item({ keyword: '순면 소재', score: 5 }),
      item({ keyword: '욕실 매트', score: 5 }),
    ]
    const input = { productName, existing: [], masterPool, rules, productContext }
    expect(suggestKeywords(input)).toEqual(suggestKeywords(input))
  })
})

describe('suggestKeywords — §10 한국어 복합어 (검증기와 같은 판정을 쓴다)', () => {
  // 추천과 편집기 검증이 갈리면 추천 칩을 누르는 순간 경고가 뜨는 모순이 생긴다.
  const braName = '에이엠엘 쿨 메쉬 심리스 커버 브라 노와이어 후크없이 편안한 중년 여성 속옷'

  it('상품명 단어를 붙여 만든 후보는 추천에서 빠진다', () => {
    const result = suggestKeywords({
      productName: braName,
      existing: [],
      masterPool: [item({ keyword: '심리스브라' }), item({ keyword: '노와이어브라' })],
      rules,
    })
    expect(result).toEqual([])
  })

  it('상품명 단어가 섞인 후보도 추천에서 빠진다', () => {
    // 편집기가 '티셔츠' 로 고치라고 제안할 후보를 추천 목록에 다시 올리면 앞뒤가 안 맞는다.
    const result = suggestKeywords({
      productName: braName,
      existing: [],
      masterPool: [item({ keyword: '갱년기여성속옷' }), item({ keyword: '티셔츠브라' })],
      rules,
    })
    expect(result).toEqual([])
  })

  it('상품명 단어가 전혀 없는 후보는 남는다', () => {
    const result = suggestKeywords({
      productName: braName,
      existing: [],
      masterPool: [item({ keyword: '갱년기' }), item({ keyword: '티셔츠' })],
      rules,
    })
    expect(result).toEqual(expect.arrayContaining(['갱년기', '티셔츠']))
  })
})

import { DEFAULT_KEYWORD_RULES } from '../keyword-rules'
import { suggestKeywords, type SuggestPoolItem } from '../keyword-suggest'

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
})

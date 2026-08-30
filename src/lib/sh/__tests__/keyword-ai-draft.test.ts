// @google/genai 는 ESM 전용이라 Jest(CJS)가 파싱하지 못한다. 이 테스트는 프롬프트 조립과
// 응답 파서만 보므로 SDK 를 통째로 스텁한다(네트워크 호출 경로는 여기서 다루지 않는다).
jest.mock('@google/genai', () => ({ GoogleGenAI: class {} }))

import {
  buildUserPrompt,
  KEYWORD_OVERGENERATE,
  parseDraft,
  REVIEW_LIMIT,
  type NameDraftInput,
} from '../keyword-ai-draft'

const baseInput: NameDraftInput = {
  brandName: null,
  productName: '무쇠 프라이팬 28cm',
  categoryName: null,
  description: null,
  features: [],
  certifications: [],
  optionSummary: [],
  existingKeywords: [],
  adTerms: [],
  keywordPool: [],
  channelName: '쿠팡',
  nameTargetMin: 40,
  nameTargetMax: 70,
}

const wrap = (obj: unknown) => JSON.stringify(obj)

describe('parseDraft', () => {
  it('keywords 를 {keyword,intent,reason} 객체 배열로 읽는다', () => {
    const r = parseDraft(
      wrap({
        names: ['이름'],
        keywords: [{ keyword: '캠핑 조리', intent: 'PURPOSE', reason: '사유' }],
      })
    )
    expect(r?.keywords).toEqual([{ keyword: '캠핑 조리', intent: 'PURPOSE', reason: '사유' }])
  })

  it('과생성분을 자르지 않는다 (예전 20 상한 회귀 방지)', () => {
    const keywords = Array.from({ length: KEYWORD_OVERGENERATE }, (_, i) => ({
      keyword: `후보${i}`,
      intent: 'PURPOSE',
      reason: '',
    }))
    const r = parseDraft(wrap({ names: [], keywords }))
    expect(r?.keywords).toHaveLength(KEYWORD_OVERGENERATE)
  })

  it('intent 가 규격 밖이면 후보를 버리지 않고 ATTRIBUTE 로 떨어뜨린다', () => {
    const r = parseDraft(
      wrap({ names: [], keywords: [{ keyword: 'ㄱ', intent: '용도', reason: '' }] })
    )
    expect(r?.keywords[0].intent).toBe('ATTRIBUTE')
  })

  it('label 이 규격 밖인 진단은 버린다 (잘못된 제거 권고 방지)', () => {
    const r = parseDraft(
      wrap({
        names: ['이름'],
        keywords: [],
        reviews: [
          { keyword: 'a', label: 'BAD_LABEL', reason: '' },
          { keyword: 'b', label: 'keep', reason: '' },
        ],
      })
    )
    expect(r?.reviews).toEqual([{ keyword: 'b', label: 'KEEP', reason: '' }])
  })

  it('reviews 를 REVIEW_LIMIT 개로 자른다', () => {
    const reviews = Array.from({ length: REVIEW_LIMIT + 5 }, (_, i) => ({
      keyword: `등록어${i}`,
      label: 'KEEP',
      reason: '',
    }))
    const r = parseDraft(wrap({ names: ['이름'], keywords: [], reviews }))
    expect(r?.reviews).toHaveLength(REVIEW_LIMIT)
  })

  it('reviews 누락·비배열이면 빈 배열', () => {
    expect(parseDraft(wrap({ names: ['이름'], keywords: [] }))?.reviews).toEqual([])
    expect(parseDraft(wrap({ names: ['이름'], keywords: [], reviews: 'x' }))?.reviews).toEqual([])
  })

  it('잘린 JSON 은 null (MAX_TOKENS 절단 방어)', () => {
    expect(parseDraft('{"names": ["이름"], "keywords": [{"keyword": "ㄱ"')).toBeNull()
  })

  it('names·keywords 가 모두 비면 null', () => {
    expect(parseDraft(wrap({ names: [], keywords: [], reviews: [] }))).toBeNull()
  })

  it('코드블록으로 감싸도 파싱한다', () => {
    const r = parseDraft('```json\n{"names":["이름"],"keywords":[]}\n```')
    expect(r?.names).toEqual(['이름'])
  })
})

describe('buildUserPrompt — 근거 섹션은 값이 있을 때만 넣는다', () => {
  it('광고 검색어·키워드 풀이 비면 해당 줄이 아예 없다', () => {
    const p = buildUserPrompt(baseInput)
    expect(p).not.toContain('[실제 유입된 검색어')
    expect(p).not.toContain('[우리 공간의 기존 검색어 풀')
    expect(p).not.toContain('[이미 등록된 검색어')
  })

  it('광고 검색어가 있으면 클릭·주문 수치와 함께 넣는다', () => {
    const p = buildUserPrompt({
      ...baseInput,
      adTerms: [{ keyword: '냉동밥용기', clicks: 312, orders: 21 }],
    })
    expect(p).toContain('[실제 유입된 검색어')
    expect(p).toContain('냉동밥용기 (클릭 312, 주문 21)')
  })

  it('등록 검색어·풀이 있으면 각각의 줄을 넣는다', () => {
    const p = buildUserPrompt({
      ...baseInput,
      existingKeywords: ['밀프렙용기'],
      keywordPool: ['자취살림'],
    })
    expect(p).toContain('[이미 등록된 검색어 — 중복 제안 금지, 진단 대상] 밀프렙용기')
    expect(p).toContain('[우리 공간의 기존 검색어 풀 — 참고용] 자취살림')
  })
})

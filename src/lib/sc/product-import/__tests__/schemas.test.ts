import { normalizeExtracted, productExtractRequestSchema } from '../schemas'

describe('normalizeExtracted', () => {
  it('배열을 줄바꿈으로 합치고 중복을 제거한다', () => {
    const d = normalizeExtracted({
      name: '테스트 상품',
      features: ['방수', '방수', '경량', '  '],
    })
    expect(d.customFields).toContainEqual({ key: '핵심 기능', value: '방수\n경량' })
  })

  it('oneLinerPitch 가 없으면 description 첫 문장을 쓴다', () => {
    const d = normalizeExtracted({
      name: 'a',
      description: '가벼운 여름용 티셔츠입니다. 통기성이 좋습니다.',
    })
    expect(d.oneLinerPitch).toBe('가벼운 여름용 티셔츠입니다.')
  })

  it('길이 초과를 거부하지 않고 잘라낸다', () => {
    const d = normalizeExtracted({
      name: 'x'.repeat(300),
      oneLinerPitch: 'y'.repeat(300),
      description: 'z'.repeat(3000),
    })
    expect(d.name).toHaveLength(200)
    expect(d.oneLinerPitch).toHaveLength(200)
    expect(d.customFields.find((f) => f.key === '상세 설명')?.value).toHaveLength(2000)
  })

  it('목록은 20개까지만 담는다', () => {
    const d = normalizeExtracted({
      name: 'a',
      features: Array.from({ length: 40 }, (_, i) => `기능${i}`),
    })
    expect(d.customFields.find((f) => f.key === '핵심 기능')?.value.split('\n')).toHaveLength(20)
  })

  it('빈 필드는 customField 를 만들지 않는다', () => {
    const d = normalizeExtracted({ name: 'a', features: [], certifications: undefined })
    expect(d.customFields).toEqual([])
  })

  it('모델이 아무것도 안 줘도 throw 하지 않는다', () => {
    const d = normalizeExtracted({})
    expect(d.name).toBe('')
    expect(d.isActive).toBe(true)
  })
})

describe('productExtractRequestSchema', () => {
  it('url 또는 pastedText 중 하나는 있어야 한다', () => {
    expect(productExtractRequestSchema.safeParse({}).success).toBe(false)
    expect(
      productExtractRequestSchema.safeParse({ url: 'https://example.com/p/1' }).success
    ).toBe(true)
    expect(productExtractRequestSchema.safeParse({ pastedText: 'x'.repeat(60) }).success).toBe(true)
  })

  it('짧은 붙여넣기는 거부한다', () => {
    expect(productExtractRequestSchema.safeParse({ pastedText: '짧음' }).success).toBe(false)
  })
})

import { invProductToDraft, jsonToText } from '../map-inv-product'
import { firstSentence, clampText } from '../labels'

describe('jsonToText', () => {
  it('string / string[] / 객체배열을 모두 텍스트로 만든다', () => {
    expect(jsonToText('가벼운 소재')).toBe('가벼운 소재')
    expect(jsonToText(['방수', '경량'])).toBe('방수, 경량')
    expect(jsonToText([{ name: 'KC 인증' }, { value: 'OEKO-TEX' }])).toBe('KC 인증, OEKO-TEX')
  })

  it('알 수 없는 객체도 [object Object] 로 새지 않는다', () => {
    expect(jsonToText({ foo: 1 })).toBe('{"foo":1}')
    expect(jsonToText(null)).toBe('')
    expect(jsonToText(undefined)).toBe('')
  })
})

describe('firstSentence', () => {
  it('종결부호까지만 자른다', () => {
    expect(firstSentence('첫 문장입니다. 둘째 문장입니다.')).toBe('첫 문장입니다.')
  })
  it('종결부호가 없으면 첫 줄을 쓴다', () => {
    expect(firstSentence('제목만 있음\n본문')).toBe('제목만 있음')
  })
  it('빈 입력은 빈 문자열', () => {
    expect(firstSentence('   ')).toBe('')
  })
})

describe('invProductToDraft', () => {
  it('공식명을 쓰고 첫 문장을 한 줄 소개로 만든다', () => {
    const d = invProductToDraft({
      name: '워크덱 베이직 티셔츠',
      description: '순면 100% 티셔츠입니다. 사계절 착용 가능합니다.',
      status: 'ACTIVE',
    })
    expect(d.name).toBe('워크덱 베이직 티셔츠')
    expect(d.oneLinerPitch).toBe('순면 100% 티셔츠입니다.')
    expect(d.customFields).toContainEqual({
      key: '상세 설명',
      value: '순면 100% 티셔츠입니다. 사계절 착용 가능합니다.',
    })
    expect(d.isActive).toBe(true)
  })

  it('빈 값은 customField 를 만들지 않는다', () => {
    const d = invProductToDraft({ name: '이름만', description: null, features: [] })
    expect(d.customFields).toEqual([])
    expect(d.oneLinerPitch).toBe('')
  })

  it('msrp 를 한국어 통화 표기로 만들고 0 이하는 버린다', () => {
    expect(invProductToDraft({ name: 'a', msrp: 19900 }).customFields).toContainEqual({
      key: '권장 소비자가',
      value: '19,900원',
    })
    expect(invProductToDraft({ name: 'a', msrp: 0 }).customFields).toEqual([])
    // Prisma Decimal 은 객체로 오지만 Number() 로 변환된다
    expect(
      invProductToDraft({ name: 'a', msrp: { toString: () => '25000' } }).customFields
    ).toContainEqual({ key: '권장 소비자가', value: '25,000원' })
  })

  it('이름 200자·한 줄 소개 200자로 자른다', () => {
    const long = 'x'.repeat(300)
    const d = invProductToDraft({ name: long, description: long })
    expect(d.name).toHaveLength(200)
    expect(d.oneLinerPitch).toHaveLength(200)
  })

  it('INACTIVE 상품은 비활성으로 가져온다', () => {
    expect(invProductToDraft({ name: 'a', status: 'INACTIVE' }).isActive).toBe(false)
  })

  it('brand.name 을 브랜드 항목으로 옮긴다', () => {
    const d = invProductToDraft({ name: 'a', brand: { name: '워크덱' } })
    expect(d.customFields).toContainEqual({ key: '브랜드', value: '워크덱' })
  })
})

describe('clampText', () => {
  it('공백을 정리하고 상한을 넘으면 자른다', () => {
    expect(clampText('  abc  ', 10)).toBe('abc')
    expect(clampText('abcdef', 3)).toBe('abc')
  })
})

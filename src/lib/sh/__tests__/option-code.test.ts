import { dedupeOptionSkus, generateOptionSku, type AttrCodeSpec } from '../option-code'

describe('generateOptionSku 충돌', () => {
  const spec = (attrIdx: number, code: string, maxLen: number): AttrCodeSpec => ({
    attrIdx,
    code,
    maxLen,
  })

  it('속성 코드가 모두 비면 상품코드만 남아 조합끼리 충돌한다', () => {
    const a = generateOptionSku({ productCode: 'P', attributeCodes: [spec(0, '', 0)] })
    const b = generateOptionSku({ productCode: 'P', attributeCodes: [spec(0, '', 0)] })
    expect(a).toBe('P')
    expect(b).toBe(a)
  })

  it('빈 코드가 버려져 서로 다른 조합이 같은 SKU가 된다', () => {
    // (색상=S, 사이즈=공백) vs (색상=공백, 사이즈=S)
    const left = generateOptionSku({
      productCode: 'P',
      attributeCodes: [spec(0, 'S', 1), spec(1, '', 1)],
    })
    const right = generateOptionSku({
      productCode: 'P',
      attributeCodes: [spec(0, '', 1), spec(1, 'S', 1)],
    })
    expect(left).toBe('P-S')
    expect(right).toBe(left)
  })
})

describe('dedupeOptionSkus', () => {
  it('첫 등장은 원본을 유지하고 이후부터 접미사를 붙인다', () => {
    expect(dedupeOptionSkus(['P-S', 'P-S', 'P-S'])).toEqual(['P-S', 'P-S-2', 'P-S-3'])
  })

  it('충돌이 없으면 그대로 둔다', () => {
    expect(dedupeOptionSkus(['P-S', 'P-M'])).toEqual(['P-S', 'P-M'])
  })

  it('reserved에 이미 있는 값은 첫 등장부터 접미사를 받는다', () => {
    expect(dedupeOptionSkus(['P-S'], ['P-S'])).toEqual(['P-S-2'])
  })

  it('reserved가 접미사 자리까지 점유했으면 다음 번호로 건너뛴다', () => {
    expect(dedupeOptionSkus(['P-S', 'P-S'], ['P-S', 'P-S-2'])).toEqual(['P-S-3', 'P-S-4'])
  })

  it('빈 문자열은 중복 판정에서 제외하고 그대로 돌려준다', () => {
    expect(dedupeOptionSkus(['', '', 'P'])).toEqual(['', '', 'P'])
  })

  it('reserved의 공백/빈 값은 무시한다', () => {
    expect(dedupeOptionSkus(['P-S'], ['', '  '])).toEqual(['P-S'])
  })

  it('입력 순서를 유지한다 — 같은 집합이라도 순서가 다르면 배정이 달라진다', () => {
    expect(dedupeOptionSkus(['A', 'B', 'A'])).toEqual(['A', 'B', 'A-2'])
    expect(dedupeOptionSkus(['A', 'A', 'B'])).toEqual(['A', 'A-2', 'B'])
  })

  it('앞뒤 공백은 다듬어 비교한다', () => {
    expect(dedupeOptionSkus(['P-S', ' P-S '])).toEqual(['P-S', 'P-S-2'])
  })
})

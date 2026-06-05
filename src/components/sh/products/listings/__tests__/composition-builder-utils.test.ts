import { buildSimpleCompositionGroups } from '../composition-builder-utils'

describe('buildSimpleCompositionGroups', () => {
  it('builds groups when optionAttributes are legacy string values', () => {
    const groups = buildSimpleCompositionGroups({
      product: {
        optionAttributes: [
          { name: '사이즈', values: ['M', 'L'] },
          { name: '색상', values: ['블루베리', '오렌지에이드'] },
        ],
        options: [
          option('m-blue', { 사이즈: 'M', 색상: '블루베리' }),
          option('m-orange', { 사이즈: 'M', 색상: '오렌지에이드' }),
          option('l-blue', { 사이즈: 'L', 색상: '블루베리' }),
          option('l-orange', { 사이즈: 'L', 색상: '오렌지에이드' }),
        ],
      },
      attrState: {
        사이즈: { enabled: true, valueQuantities: {} },
        색상: { enabled: true, valueQuantities: {} },
      },
      setQuantities: [1],
    })

    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.items[0].optionId).sort()).toEqual([
      'l-blue',
      'l-orange',
      'm-blue',
      'm-orange',
    ])
  })

  it('counts only combinations backed by real options', () => {
    const groups = buildSimpleCompositionGroups({
      product: {
        optionAttributes: [
          { name: '사이즈', values: [{ value: 'M' }, { value: 'L' }] },
          { name: '색상', values: [{ value: '블루베리' }, { value: '오렌지에이드' }] },
        ],
        options: [option('m-blue', { 사이즈: 'M', 색상: '블루베리' })],
      },
      attrState: {},
      setQuantities: [1],
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].suffixParts).toEqual(['M', '블루베리'])
  })
})

function option(id: string, attributeValues: Record<string, string>) {
  return {
    id,
    name: Object.values(attributeValues).join(' / '),
    sku: null,
    retailPrice: null,
    attributeValues,
  }
}

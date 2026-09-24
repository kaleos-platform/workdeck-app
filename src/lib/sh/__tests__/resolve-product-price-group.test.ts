import { resolveFirstPriceGroup } from '@/lib/sh/resolve-product-price-group'
import type { OptionInput } from '@/lib/sh/price-group'

function opt(id: string, cost: number | null, retail: number | null): OptionInput {
  return { optionId: id, optionName: id, costPrice: cost, retailPrice: retail }
}

describe('resolveFirstPriceGroup', () => {
  it('옵션 없으면 null', () => {
    expect(resolveFirstPriceGroup([])).toBeNull()
  })

  it('가격 정의된 첫 그룹을 대표로 선택하고 optionIds를 묶는다', () => {
    const options = [opt('a', 5000, 12000), opt('b', 5000, 12000), opt('c', 8000, 20000)]
    const r = resolveFirstPriceGroup(options)
    expect(r).toEqual({
      optionId: 'a',
      optionIds: ['a', 'b'],
      costPrice: 5000,
      retailPrice: 12000,
    })
  })

  it('가격 미정 그룹은 건너뛰고 정의된 그룹을 우선한다', () => {
    const options = [opt('x', null, null), opt('y', 3000, 9000)]
    const r = resolveFirstPriceGroup(options)
    expect(r?.optionId).toBe('y')
    expect(r?.costPrice).toBe(3000)
  })

  it('모두 미정이면 첫 그룹을 0 폴백으로 반환', () => {
    const options = [opt('x', null, 9000), opt('z', null, 9000)]
    const r = resolveFirstPriceGroup(options)
    expect(r?.optionId).toBe('x')
    expect(r?.optionIds).toEqual(['x', 'z'])
    expect(r?.costPrice).toBe(0)
    expect(r?.retailPrice).toBe(9000)
  })

  it('선택한 가격 그룹의 원가 구성을 전달한다', () => {
    const options: OptionInput[] = [
      {
        ...opt('a', 13000, 30000),
        productionUnitCost: 10000,
        marketingUnitCost: 3000,
      },
    ]

    expect(resolveFirstPriceGroup(options)).toMatchObject({
      productionUnitCost: 10000,
      marketingUnitCost: 3000,
    })
  })

  it('레거시 입력은 원가 구성을 undefined로 유지한다', () => {
    const resolved = resolveFirstPriceGroup([opt('a', 5000, 12000)])

    expect(resolved?.productionUnitCost).toBeUndefined()
    expect(resolved?.marketingUnitCost).toBeUndefined()
  })
})

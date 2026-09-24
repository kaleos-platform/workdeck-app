import { validateProductionCostTargets } from '@/lib/sh/production-run-costs'

const marketing = (targetProductId: string) => ({
  category: 'MARKETING' as const,
  targetProductId,
})

describe('validateProductionCostTargets', () => {
  test('마케팅 비용의 대상 상품이 생산 차수에 포함되면 허용한다', () => {
    expect(validateProductionCostTargets([marketing('p1')], new Set(['p1', 'p2']))).toBeNull()
  })

  test('마케팅 비용의 대상 상품이 생산 차수에 없으면 거부한다', () => {
    expect(validateProductionCostTargets([marketing('p3')], new Set(['p1', 'p2']))).toBe(
      '마케팅 비용의 대상 상품이 생산 차수에 포함되어 있지 않습니다'
    )
  })

  test('마케팅 비용에 대상 상품이 없으면 거부한다', () => {
    expect(validateProductionCostTargets([{ category: 'MARKETING' }], new Set(['p1', 'p2']))).toBe(
      '마케팅 비용의 대상 상품을 선택하세요'
    )
  })

  test('마케팅 이외 비용의 대상 상품은 무시한다', () => {
    expect(
      validateProductionCostTargets(
        [{ category: 'MATERIAL', targetProductId: '다른 상품' }],
        new Set(['p1', 'p2'])
      )
    ).toBeNull()
  })
})

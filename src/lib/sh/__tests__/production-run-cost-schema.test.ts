import { productionRunCostSchema } from '@/lib/sh/schemas'

const baseInput = {
  itemName: '체험단',
  quantity: 1,
  unitPrice: 3_000_000,
  vatIncluded: true,
}

describe('productionRunCostSchema', () => {
  test('MARKETING 비용에 대상 상품이 없으면 거부한다', () => {
    const result = productionRunCostSchema.safeParse({
      ...baseInput,
      category: 'MARKETING',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: 'custom',
          message: '마케팅 비용의 대상 상품을 선택하세요',
          path: ['targetProductId'],
        })
      )
    }
  })

  test('MARKETING 비용은 대상 상품 ID를 보존한다', () => {
    const result = productionRunCostSchema.parse({
      ...baseInput,
      category: 'MARKETING',
      targetProductId: 'product-12345678',
    })

    expect(result.targetProductId).toBe('product-12345678')
  })

  test('MARKETING 이외 비용은 대상 상품 ID를 제거한다', () => {
    const result = productionRunCostSchema.parse({
      ...baseInput,
      category: 'MATERIAL',
      targetProductId: 'product-12345678',
    })

    expect(result.targetProductId).toBeUndefined()
  })

  test.each([null, ''])(
    'MARKETING 이외 비용은 빈 대상 상품 ID %p를 제거한다',
    (targetProductId) => {
      const result = productionRunCostSchema.parse({
        ...baseInput,
        category: 'MATERIAL',
        targetProductId,
      })

      expect(result.targetProductId).toBeUndefined()
    }
  )

  test.each([null, ''])('MARKETING 비용은 빈 대상 상품 ID %p를 거부한다', (targetProductId) => {
    const result = productionRunCostSchema.safeParse({
      ...baseInput,
      category: 'MARKETING',
      targetProductId,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          code: 'custom',
          message: '마케팅 비용의 대상 상품을 선택하세요',
          path: ['targetProductId'],
        })
      )
    }
  })

  test('MARKETING 이외 비용도 유효하지 않은 non-empty 대상 상품 ID는 거부한다', () => {
    const result = productionRunCostSchema.safeParse({
      ...baseInput,
      category: 'MATERIAL',
      targetProductId: 'short',
    })

    expect(result.success).toBe(false)
  })
})

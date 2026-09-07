import { resolveBaseProduct } from '../steps/naming-sop-types'

// 회귀 방지: 기준 상품을 items[0] 로 잡으면, 세트·묶음처럼 여러 상품이 섞인 리스팅에서
// 첫 상품의 브랜드·카테고리·광고 검색어가 나머지 옵션과 무관한데도 Fact Sheet 프리필과
// 검색어 후보 전체를 좌우한다. 하나로 좁혀질 때만 기준으로 써야 한다.

describe('resolveBaseProduct', () => {
  it('구성 옵션이 한 상품이면 그 상품을 기준으로 쓴다', () => {
    expect(resolveBaseProduct([{ productId: 'p1' }, { productId: 'p1' }])).toEqual({
      productId: 'p1',
      mixedProducts: false,
    })
  })

  it('여러 상품이 섞이면 기준을 두지 않는다 — 첫 상품으로 떨어지면 안 된다', () => {
    const result = resolveBaseProduct([{ productId: 'p1' }, { productId: 'p2' }])
    expect(result).toEqual({ productId: null, mixedProducts: true })
    expect(result.productId).not.toBe('p1')
  })

  it('구성 옵션이 없으면 기준도 없고 혼합도 아니다', () => {
    expect(resolveBaseProduct([])).toEqual({ productId: null, mixedProducts: false })
  })

  it('productId 가 비어 있는 항목은 무시한다', () => {
    expect(
      resolveBaseProduct([{ productId: null }, { productId: 'p1' }, { productId: undefined }])
    ).toEqual({ productId: 'p1', mixedProducts: false })
  })

  it('빈 값만 있으면 기준이 없다', () => {
    expect(resolveBaseProduct([{ productId: null }, { productId: '' }])).toEqual({
      productId: null,
      mixedProducts: false,
    })
  })
})

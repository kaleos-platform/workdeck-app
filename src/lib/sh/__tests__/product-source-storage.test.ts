/**
 * isOwnedSourcePath — 순수 함수 단위 테스트. 네트워크/Supabase 호출 없음.
 * 다른 Space가 남의 파일 경로를 참조하지 못하게 막는 가드.
 */
import { isOwnedSourcePath } from '@/lib/sh/product-source-storage'

describe('isOwnedSourcePath', () => {
  const spaceId = 'space-a'
  const productId = 'product-1'

  it('정확히 일치하는 경로는 true', () => {
    expect(isOwnedSourcePath(`${spaceId}/products/${productId}/uuid.png`, spaceId, productId)).toBe(
      true
    )
  })

  it('다른 spaceId 경로는 false', () => {
    expect(isOwnedSourcePath(`space-b/products/${productId}/uuid.png`, spaceId, productId)).toBe(
      false
    )
  })

  it('다른 productId 경로는 false', () => {
    expect(
      isOwnedSourcePath(`${spaceId}/products/other-product/uuid.png`, spaceId, productId)
    ).toBe(false)
  })

  it('.. 경로 탈출 시도는 false', () => {
    expect(
      isOwnedSourcePath(
        `${spaceId}/products/${productId}/../../space-b/products/x/uuid.png`,
        spaceId,
        productId
      )
    ).toBe(false)
    expect(
      isOwnedSourcePath(`../${spaceId}/products/${productId}/uuid.png`, spaceId, productId)
    ).toBe(false)
  })

  it('접두사만 비슷하고 실제로는 다른 productId(부분 문자열)인 경로는 false', () => {
    // productId가 "product-1"인데 실제 경로는 "product-10" — startsWith 오탐 방지 확인
    expect(isOwnedSourcePath(`${spaceId}/products/product-10/uuid.png`, spaceId, productId)).toBe(
      false
    )
  })
})

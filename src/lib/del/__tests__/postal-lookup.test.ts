/**
 * @jest-environment node
 */
import { simplifyAddress } from '../postal-lookup'

describe('simplifyAddress', () => {
  it('괄호 상세·동/호를 제거하고 도로명+건물번호까지 남긴다', () => {
    expect(simplifyAddress('서울특별시 송파구 올림픽로 135 (잠실동, 리센츠) 228동 1702호')).toBe(
      '서울특별시 송파구 올림픽로 135'
    )
    expect(
      simplifyAddress('서울특별시 노원구 상계로26길 20 (상계동, 대동청솔아파트) 103동 1101호')
    ).toBe('서울특별시 노원구 상계로26길 20')
  })

  it('도로명에 숫자가 포함돼도(송학로10길) 건물번호까지 유지한다', () => {
    expect(simplifyAddress('충청북도 제천시 송학면 송학로10길 26 테라코 코리아 기술센터')).toBe(
      '충청북도 제천시 송학면 송학로10길 26'
    )
  })

  it('건물명·층을 제거한다', () => {
    expect(simplifyAddress('경기도 성남시 분당구 판교역로 235 에이치스퀘어 N동 7층')).toBe(
      '경기도 성남시 분당구 판교역로 235'
    )
  })

  it('상세 없는 도로명 주소는 그대로 둔다', () => {
    expect(simplifyAddress('서울 강남구 테헤란로 152')).toBe('서울 강남구 테헤란로 152')
  })
})

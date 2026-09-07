/**
 * 추출 결과를 기존 특징에 '추가(merge)'할 때 항목이 잘리지 않는지 검증한다.
 *
 * 특징·인증정보가 상한 20을 공유하던 시절, 기존 15개 + 추출 10개를 병합하면
 * 아무 경고 없이 20개로 잘렸다(사용자가 보고한 "추가가 안 됨"의 실체).
 */
import { mergeList } from '../product-extract-review'
import { PRODUCT_FEATURES_MAX_ITEMS, PRODUCT_LIST_FIELD_MAX_ITEMS } from '@/lib/sh/constants'

const seq = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

describe('mergeList', () => {
  test('특징은 기존 15 + 추출 10을 모두 유지한다 (구 상한 20에서 잘리지 않음)', () => {
    const out = mergeList(seq('기존', 15), seq('추출', 10), [], 'merge', PRODUCT_FEATURES_MAX_ITEMS)
    expect(out).toHaveLength(25)
    expect(out[0]).toBe('기존1')
    expect(out[24]).toBe('추출10')
  })

  test('인증정보는 상한 20을 유지한다', () => {
    const out = mergeList(
      seq('기존', 15),
      seq('추출', 10),
      [],
      'merge',
      PRODUCT_LIST_FIELD_MAX_ITEMS
    )
    expect(out).toHaveLength(PRODUCT_LIST_FIELD_MAX_ITEMS)
  })

  test('replace 모드는 기존을 버리고 선택 + 직접입력만 남긴다', () => {
    const out = mergeList(seq('기존', 5), ['A'], ['B'], 'replace', PRODUCT_FEATURES_MAX_ITEMS)
    expect(out).toEqual(['A', 'B'])
  })

  test('중복·공백은 제거하고 각 항목은 200자로 자른다', () => {
    const long = 'x'.repeat(250)
    const out = mergeList(['A'], ['A', '  ', long], [], 'merge', PRODUCT_FEATURES_MAX_ITEMS)
    expect(out).toEqual(['A', 'x'.repeat(200)])
  })

  test('상한을 넘으면 그 지점에서 멈춘다', () => {
    const out = mergeList(
      seq('기존', PRODUCT_FEATURES_MAX_ITEMS + 50),
      [],
      [],
      'merge',
      PRODUCT_FEATURES_MAX_ITEMS
    )
    expect(out).toHaveLength(PRODUCT_FEATURES_MAX_ITEMS)
  })
})

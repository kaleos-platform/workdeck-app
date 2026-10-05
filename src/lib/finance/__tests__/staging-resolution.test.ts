import { shouldPreserveClassification } from '../staging-resolution'

const call = (
  priorClassified: boolean,
  resolution: Parameters<typeof shouldPreserveClassification>[0]['resolution'],
  stagedCategoryId: string | null
) => shouldPreserveClassification({ priorClassified, resolution, stagedCategoryId })

describe('shouldPreserveClassification — 재업로드 시 기존 분류 보존 판정', () => {
  test('기존 분류가 없으면 보존할 것이 없다', () => {
    expect(call(false, 'DUP_CHANGED', 'cat-1')).toBe(false)
    expect(call(false, 'DUP_OVERWRITE', null)).toBe(false)
  })

  test('「유지」를 누르지 않은 중복은 기존 분류를 보존한다', () => {
    expect(call(true, 'DUP_CHANGED', 'cat-1')).toBe(true)
    expect(call(true, 'DUP_CHANGED', null)).toBe(true)
    expect(call(true, 'DUP_SAME', 'cat-1')).toBe(true)
  })

  test('「유지」 + 재업로드분에 분류가 있으면 교체한다 — 사용자가 명시 선택한 경우', () => {
    expect(call(true, 'DUP_OVERWRITE', 'cat-2')).toBe(false)
  })

  test('「유지」라도 재업로드분이 미분류면 기존 분류를 지우지 않는다', () => {
    // 가드 없이는 238건의 분류가 null로 덮인다
    expect(call(true, 'DUP_OVERWRITE', null)).toBe(true)
  })
})

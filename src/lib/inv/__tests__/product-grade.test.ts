import { isReturnGrade } from '../product-grade'

describe('isReturnGrade', () => {
  it('정상 등급은 false', () => {
    expect(isReturnGrade('NEW')).toBe(false)
  })

  it('반품 등급은 전부 true — 목록을 하드코딩하지 않으므로 새 등급도 잡힌다', () => {
    for (const g of ['반품-최상', '반품-상', '반품-중', '반품-미개봉', '반품-신규등급']) {
      expect(isReturnGrade(g)).toBe(true)
    }
  })

  it('값이 없으면 정상으로 본다 — 등급을 싣지 않던 데이터·수집 경로 호환', () => {
    expect(isReturnGrade(undefined)).toBe(false)
    expect(isReturnGrade(null)).toBe(false)
    expect(isReturnGrade('')).toBe(false)
  })
})

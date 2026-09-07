/**
 * normalizeExtracted — 순수 함수 단위 테스트. 네트워크/SDK 호출 없음.
 * product-extract.ts는 @google/genai를 타입으로만 참조하고 SDK는 동적 import 하므로
 * 이 테스트는 별도 mock 없이 모듈을 그대로 import 한다.
 */

import { normalizeExtracted } from '@/lib/sh/product-extract'
import { PRODUCT_DESCRIPTION_MAX } from '@/lib/sh/constants'

describe('normalizeExtracted', () => {
  it('description을 PRODUCT_DESCRIPTION_MAX로 클램프하고 truncatedFields에 기록한다', () => {
    const long = 'a'.repeat(PRODUCT_DESCRIPTION_MAX + 500)
    const out = normalizeExtracted({
      description: long,
      features: [],
      certifications: [],
      confidence: 1,
    })
    expect(out.description).toHaveLength(PRODUCT_DESCRIPTION_MAX)
    expect(out.truncatedFields).toContain('description')
  })

  it('길이 이내 description은 클램프되지 않는다', () => {
    const out = normalizeExtracted({
      description: '짧은 설명입니다',
      features: [],
      certifications: [],
      confidence: 1,
    })
    expect(out.description).toBe('짧은 설명입니다')
    expect(out.truncatedFields).not.toContain('description')
  })

  it('빈 문자열 description은 null이 된다', () => {
    const out = normalizeExtracted({
      description: '   ',
      features: [],
      certifications: [],
      confidence: 1,
    })
    expect(out.description).toBeNull()
  })

  it('배열 필드는 trim·빈값 제거·중복 제거(순서 보존)한다', () => {
    const out = normalizeExtracted({
      description: null,
      features: [' 방수 ', '방수', '경량', '', '   ', 'USB-C'],
      certifications: [],
      confidence: 1,
    })
    expect(out.features).toEqual(['방수', '경량', 'USB-C'])
  })

  it('배열 항목을 200자로 클램프하고 truncatedFields에 기록한다', () => {
    const longItem = 'x'.repeat(250)
    const out = normalizeExtracted({
      description: null,
      features: [longItem],
      certifications: [],
      confidence: 1,
    })
    expect(out.features[0]).toHaveLength(200)
    expect(out.truncatedFields).toContain('features')
  })

  it('배열을 20개로 캡하고 truncatedFields에 기록한다', () => {
    const many = Array.from({ length: 25 }, (_, i) => `item-${i}`)
    const out = normalizeExtracted({
      description: null,
      features: many,
      certifications: [],
      confidence: 1,
    })
    expect(out.features).toHaveLength(20)
    expect(out.truncatedFields).toContain('features')
  })

  it.each([
    [-1, 0],
    [5, 1],
    [0.5, 0.5],
    ['abc', 0],
    [undefined, 0],
    [null, 0],
  ])('confidence %p를 %p로 clamp한다', (input, expected) => {
    const out = normalizeExtracted({
      description: null,
      features: [],
      certifications: [],
      confidence: input,
    })
    expect(out.confidence).toBe(expected)
  })

  it('null/undefined/가비지 입력에도 throw하지 않는다', () => {
    expect(() => normalizeExtracted(null)).not.toThrow()
    expect(() => normalizeExtracted(undefined)).not.toThrow()
    expect(() => normalizeExtracted('아무 문자열')).not.toThrow()
    expect(() => normalizeExtracted(42)).not.toThrow()
    expect(() => normalizeExtracted([1, 2, 3])).not.toThrow()
  })

  it('완전히 빈 객체는 안전한 기본값을 반환한다', () => {
    const out = normalizeExtracted({})
    expect(out).toEqual({
      description: null,
      features: [],
      certifications: [],
      ingredients: [],
      capacity: null,
      originCountry: null,
      manufacturer: null,
      cautions: [],
      confidence: 0,
      notes: null,
      truncatedFields: [],
    })
  })

  it('문자열이 아닌 배열 항목은 무시한다', () => {
    const out = normalizeExtracted({
      description: null,
      features: ['정상', 123, null, {}, '정상2'],
      certifications: [],
      confidence: 1,
    })
    expect(out.features).toEqual(['정상', '정상2'])
  })
})

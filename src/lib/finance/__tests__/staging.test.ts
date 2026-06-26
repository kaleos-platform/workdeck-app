/** @jest-environment node */
import { isStagedRowCommittable } from '../staging'

describe('isStagedRowCommittable — 저장(commit) 대상 판정', () => {
  test('CLASSIFIED + NEW → true', () => {
    expect(isStagedRowCommittable({ classStatus: 'CLASSIFIED', resolution: 'NEW' })).toBe(true)
  })
  test('CLASSIFIED + DUP_CHANGED → true', () => {
    expect(isStagedRowCommittable({ classStatus: 'CLASSIFIED', resolution: 'DUP_CHANGED' })).toBe(
      true
    )
  })
  test('CLASSIFIED + DUP_SAME → false(중복 제외)', () => {
    expect(isStagedRowCommittable({ classStatus: 'CLASSIFIED', resolution: 'DUP_SAME' })).toBe(
      false
    )
  })
  test('UNCLASSIFIED → false(보류)', () => {
    expect(isStagedRowCommittable({ classStatus: 'UNCLASSIFIED', resolution: 'NEW' })).toBe(false)
  })
  test('REVIEW → false(보류)', () => {
    expect(isStagedRowCommittable({ classStatus: 'REVIEW', resolution: 'NEW' })).toBe(false)
  })
})

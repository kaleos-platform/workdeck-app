// @jest-environment node
import {
  assertBoMaterialTransition,
  getAllowedTransitions,
  BoMaterialTransitionError,
} from '../material-state'
import type { BoMaterialStatus } from '@/generated/prisma/client'

describe('assertBoMaterialTransition', () => {
  // 허용된 전환
  it.each<[BoMaterialStatus, BoMaterialStatus]>([
    ['PROPOSED', 'APPROVED'],
    ['PROPOSED', 'REJECTED'],
    ['REJECTED', 'PROPOSED'],
    ['APPROVED', 'ARCHIVED'],
  ])('%s → %s 전환을 허용한다', (from, to) => {
    expect(() => assertBoMaterialTransition(from, to)).not.toThrow()
  })

  // 금지된 전환
  it.each<[BoMaterialStatus, BoMaterialStatus]>([
    ['ARCHIVED', 'PROPOSED'],
    ['ARCHIVED', 'APPROVED'],
    ['ARCHIVED', 'REJECTED'],
    ['APPROVED', 'PROPOSED'],
    ['APPROVED', 'REJECTED'],
    ['PROPOSED', 'ARCHIVED'],
    ['REJECTED', 'APPROVED'],
    ['REJECTED', 'ARCHIVED'],
  ])('%s → %s 전환을 금지한다', (from, to) => {
    expect(() => assertBoMaterialTransition(from, to)).toThrow(BoMaterialTransitionError)
  })

  it('BoMaterialTransitionError는 Error 서브클래스다', () => {
    const err = new BoMaterialTransitionError('ARCHIVED', 'PROPOSED')
    expect(err).toBeInstanceOf(Error)
    expect(err.from).toBe('ARCHIVED')
    expect(err.to).toBe('PROPOSED')
    expect(err.message).toContain('ARCHIVED')
  })
})

describe('getAllowedTransitions', () => {
  it('PROPOSED → [APPROVED, REJECTED]', () => {
    expect(getAllowedTransitions('PROPOSED')).toEqual(
      expect.arrayContaining(['APPROVED', 'REJECTED'])
    )
    expect(getAllowedTransitions('PROPOSED')).toHaveLength(2)
  })

  it('ARCHIVED → [] (빈 배열)', () => {
    expect(getAllowedTransitions('ARCHIVED')).toEqual([])
  })
})

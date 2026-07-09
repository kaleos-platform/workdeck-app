import {
  assertBoPostTransition,
  getAllowedPostTransitions,
  BoPostTransitionError,
} from '../post-state'
import type { BoPostStatus } from '@/generated/prisma/client'

describe('assertBoPostTransition', () => {
  // ─── 허용된 전환 ────────────────────────────────────────────────────────────

  it.each<[BoPostStatus, BoPostStatus]>([
    ['GENERATING', 'DRAFT'],
    ['GENERATING', 'FAILED'],
    ['GENERATING', 'ARCHIVED'],
    ['DRAFT', 'IN_REVIEW'],
    ['DRAFT', 'ARCHIVED'],
    ['IN_REVIEW', 'PUBLISH_APPROVED'],
    ['IN_REVIEW', 'DRAFT'],
    ['IN_REVIEW', 'ARCHIVED'],
    ['PUBLISH_APPROVED', 'IN_REVIEW'],
    ['PUBLISH_APPROVED', 'PUBLISHED'],
    ['PUBLISH_APPROVED', 'ARCHIVED'],
    ['PUBLISHED', 'ARCHIVED'],
    ['PUBLISHED', 'PUBLISH_APPROVED'],
    ['FAILED', 'GENERATING'],
    ['FAILED', 'ARCHIVED'],
  ])('허용: %s → %s', (from, to) => {
    expect(() => assertBoPostTransition(from, to)).not.toThrow()
  })

  // ─── 금지된 전환 ────────────────────────────────────────────────────────────

  it.each<[BoPostStatus, BoPostStatus]>([
    ['GENERATING', 'IN_REVIEW'],
    ['GENERATING', 'PUBLISH_APPROVED'],
    ['DRAFT', 'GENERATING'],
    ['DRAFT', 'PUBLISHED'],
    ['IN_REVIEW', 'GENERATING'],
    ['IN_REVIEW', 'PUBLISHED'],
    ['IN_REVIEW', 'FAILED'],
    ['PUBLISH_APPROVED', 'GENERATING'],
    ['PUBLISH_APPROVED', 'DRAFT'],
    ['PUBLISH_APPROVED', 'FAILED'],
    ['PUBLISHED', 'DRAFT'],
    ['PUBLISHED', 'GENERATING'],
    ['PUBLISHED', 'IN_REVIEW'],
    ['ARCHIVED', 'DRAFT'],
    ['ARCHIVED', 'PUBLISHED'],
    ['ARCHIVED', 'GENERATING'],
    ['FAILED', 'DRAFT'],
    ['FAILED', 'IN_REVIEW'],
  ])('거부: %s → %s 는 BoPostTransitionError를 던진다', (from, to) => {
    expect(() => assertBoPostTransition(from, to)).toThrow(BoPostTransitionError)
  })

  it('BoPostTransitionError는 from/to 정보를 포함한다', () => {
    try {
      assertBoPostTransition('ARCHIVED', 'DRAFT')
    } catch (err) {
      expect(err).toBeInstanceOf(BoPostTransitionError)
      const e = err as BoPostTransitionError
      expect(e.from).toBe('ARCHIVED')
      expect(e.to).toBe('DRAFT')
      expect(e.message).toContain('ARCHIVED')
      expect(e.message).toContain('DRAFT')
    }
  })

  it('같은 상태로의 전환은 금지 전환으로 처리된다 (DRAFT → DRAFT)', () => {
    // 동일 상태 전환도 ALLOWED_TRANSITIONS에 없으므로 에러
    expect(() => assertBoPostTransition('DRAFT', 'DRAFT')).toThrow(BoPostTransitionError)
  })
})

describe('getAllowedPostTransitions', () => {
  it('ARCHIVED 에서는 이동 가능한 상태가 없다', () => {
    expect(getAllowedPostTransitions('ARCHIVED')).toEqual([])
  })

  it('GENERATING 에서 이동 가능한 상태 목록을 반환한다', () => {
    const allowed = getAllowedPostTransitions('GENERATING')
    expect(allowed).toContain('DRAFT')
    expect(allowed).toContain('FAILED')
    expect(allowed).toContain('ARCHIVED')
  })

  it('IN_REVIEW 에서 PUBLISH_APPROVED 와 DRAFT 모두 허용된다', () => {
    const allowed = getAllowedPostTransitions('IN_REVIEW')
    expect(allowed).toContain('PUBLISH_APPROVED')
    expect(allowed).toContain('DRAFT')
  })

  it('PUBLISHED 에서 PUBLISH_APPROVED 와 ARCHIVED 로 이동 가능하다', () => {
    const allowed = getAllowedPostTransitions('PUBLISHED')
    expect(allowed).toContain('PUBLISH_APPROVED')
    expect(allowed).toContain('ARCHIVED')
    // DRAFT 는 허용되지 않음
    expect(allowed).not.toContain('DRAFT')
  })
})

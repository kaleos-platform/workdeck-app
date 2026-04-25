// jobs.ts — Prisma/DB 의존성 없는 순수 함수에 대한 단위 테스트.
// failJob/claimJobs 같은 Prisma 호출 함수는 별도 통합 테스트 영역에서 다룬다.

import { isRetryableErrorCode, MAX_ATTEMPTS, nextRetryAt } from '../jobs'

describe('isRetryableErrorCode', () => {
  it('NETWORK / PLATFORM_ERROR 는 retryable', () => {
    expect(isRetryableErrorCode('NETWORK')).toBe(true)
    expect(isRetryableErrorCode('PLATFORM_ERROR')).toBe(true)
  })

  it('AUTH_FAILED / RATE_LIMITED / VALIDATION / NOT_IMPLEMENTED 은 non-retryable', () => {
    expect(isRetryableErrorCode('AUTH_FAILED')).toBe(false)
    expect(isRetryableErrorCode('RATE_LIMITED')).toBe(false)
    expect(isRetryableErrorCode('VALIDATION')).toBe(false)
    expect(isRetryableErrorCode('NOT_IMPLEMENTED')).toBe(false)
  })

  it('errorCode 가 비어있으면 (성공·미상) retryable 로 간주', () => {
    expect(isRetryableErrorCode(undefined)).toBe(true)
    expect(isRetryableErrorCode(null)).toBe(true)
    expect(isRetryableErrorCode('')).toBe(true)
  })

  it('알 수 없는 코드는 non-retryable 로 처리 (allowlist 정책 — 무한 재시도 방지)', () => {
    expect(isRetryableErrorCode('SOMETHING_NEW')).toBe(false)
  })
})

describe('nextRetryAt', () => {
  const t0 = new Date('2026-04-25T00:00:00Z')

  it('attempts=0 → 1분 뒤', () => {
    expect(nextRetryAt(0, t0).getTime() - t0.getTime()).toBe(60_000)
  })
  it('attempts=1 → 5분 뒤', () => {
    expect(nextRetryAt(1, t0).getTime() - t0.getTime()).toBe(5 * 60_000)
  })
  it('attempts=2 → 15분 뒤', () => {
    expect(nextRetryAt(2, t0).getTime() - t0.getTime()).toBe(15 * 60_000)
  })
  it('attempts >= MAX_ATTEMPTS 일 때도 마지막 백오프(15분) 적용', () => {
    expect(nextRetryAt(MAX_ATTEMPTS, t0).getTime() - t0.getTime()).toBe(15 * 60_000)
    expect(nextRetryAt(99, t0).getTime() - t0.getTime()).toBe(15 * 60_000)
  })
})

// @jest-environment node
// prisma 를 mock 해 Prisma 클라이언트 초기화(TextEncoder 필요) 없이 순수 함수만 테스트
jest.mock('@/lib/prisma', () => ({ prisma: {} }))

import { isBoRetryableErrorCode } from '../jobs'

describe('isBoRetryableErrorCode — H3 retryability classification', () => {
  test.each([
    ['NETWORK', true],
    ['PLATFORM_ERROR', true],
    ['PUBLISH_FAILED', true], // 일시적 에디터 오류 — 재시도 허용
  ])('%s → retryable=%s', (code, expected) => {
    expect(isBoRetryableErrorCode(code)).toBe(expected)
  })

  test.each([
    ['AUTH_FAILED', false],
    ['RATE_LIMITED', false],
    ['VALIDATION', false],
    ['NOT_IMPLEMENTED', false],
    ['LOGIN_EXPIRED', false], // 세션 만료 — 자격증명 재등록 필요
    ['EDITOR_NOT_FOUND', false], // DOM 변경 — 재시도해도 해결 안 됨
    ['URL_CAPTURE_FAILED', false], // 포스트 발행됐을 수 있어 맹목적 재시도 금지
  ])('%s → retryable=%s', (code, expected) => {
    expect(isBoRetryableErrorCode(code)).toBe(expected)
  })

  test('null/undefined → retryable (안전 기본값)', () => {
    expect(isBoRetryableErrorCode(null)).toBe(true)
    expect(isBoRetryableErrorCode(undefined)).toBe(true)
  })

  test('알 수 없는 코드 → non-retryable', () => {
    expect(isBoRetryableErrorCode('UNKNOWN_CODE')).toBe(false)
  })
})

import { resolveRedirectPath, sanitizeRedirectPath } from '../auth-redirect'

// 토스 카드등록 콜백의 returnTo, 로그인/가입의 redirectTo 가 모두 이 함수를 거친다.
// 외부 URL 이 통과하면 오픈 리다이렉트가 된다.
describe('sanitizeRedirectPath — 오픈 리다이렉트 차단', () => {
  test('내부 절대 경로는 통과', () => {
    expect(sanitizeRedirectPath('/my-deck')).toBe('/my-deck')
    expect(sanitizeRedirectPath('/my-deck?subscribe=sales-content')).toBe(
      '/my-deck?subscribe=sales-content'
    )
  })

  test('외부 URL·프로토콜 상대 경로·상대 경로는 거부', () => {
    for (const value of [
      'https://evil.example',
      'http://evil.example/path',
      '//evil.example',
      'evil.example',
      'my-deck',
    ]) {
      expect(sanitizeRedirectPath(value)).toBeNull()
    }
  })

  test('빈 값은 null', () => {
    expect(sanitizeRedirectPath(null)).toBeNull()
    expect(sanitizeRedirectPath(undefined)).toBeNull()
    expect(sanitizeRedirectPath('')).toBeNull()
  })

  test('거부된 값은 기본 경로로 대체된다', () => {
    expect(resolveRedirectPath('https://evil.example')).toBe('/my-deck')
    expect(resolveRedirectPath('/settings/payments')).toBe('/settings/payments')
  })
})

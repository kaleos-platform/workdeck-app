import {
  parseSignupSourceCookie,
  sanitizeSignupSource,
  signupSourceCookieDomain,
  signupSourceFromSearch,
} from '../signup-source'

describe('signup-source', () => {
  it('utm 쿼리에서 first-touch 값을 만든다', () => {
    const s = signupSourceFromSearch(
      new URLSearchParams('utm_source=opening&utm_medium=notice&foo=1'),
      '/signup'
    )
    expect(s).toMatchObject({ utm_source: 'opening', utm_medium: 'notice', landing: '/signup' })
    expect(s?.at).toBeTruthy()
    expect(s).not.toHaveProperty('foo')
  })

  it('utm_source 가 없으면 null', () => {
    expect(signupSourceFromSearch(new URLSearchParams('utm_medium=notice'))).toBeNull()
  })

  it('sanitize: 100자 초과 절단·비문자열·배열 제거', () => {
    const s = sanitizeSignupSource({ utm_source: 'a'.repeat(300), utm_medium: 5, x: 'y' })
    expect(s?.utm_source).toHaveLength(100)
    expect(s).not.toHaveProperty('utm_medium')
    expect(sanitizeSignupSource([])).toBeNull()
    expect(sanitizeSignupSource('x')).toBeNull()
  })

  it('쿠키 파싱: 깨진 JSON 은 null', () => {
    expect(parseSignupSourceCookie('{bad')).toBeNull()
    expect(parseSignupSourceCookie('{"utm_source":"opening"}')).toEqual({ utm_source: 'opening' })
  })

  it('쿠키 도메인: workdeck.work 계열만', () => {
    expect(signupSourceCookieDomain('workdeck.work')).toBe('.workdeck.work')
    expect(signupSourceCookieDomain('app.workdeck.work')).toBe('.workdeck.work')
    expect(signupSourceCookieDomain('localhost')).toBeUndefined()
    expect(signupSourceCookieDomain('evilworkdeck.work')).toBeUndefined()
  })
})

it('리드·referrer만 있는 출처를 보존하고 referrer는 300자로 제한한다', () => {
  expect(sanitizeSignupSource({ landing: 'lead' })).toEqual({ landing: 'lead' })
  expect(sanitizeSignupSource({ referrer: 'x'.repeat(400) })?.referrer).toHaveLength(300)
})

it('가입 경로 라벨은 리드 표시와 utm 또는 referrer 호스트를 보여준다', async () => {
  const { signupSourceLabel } = await import('../signup-source')
  expect(signupSourceLabel({ landing: 'lead', utm_source: 'google', utm_medium: 'cpc' })).toBe(
    '도입 문의 · google / cpc'
  )
  expect(signupSourceLabel({ landing: 'lead', referrer: 'https://www.example.com/path' })).toBe(
    '도입 문의 · www.example.com'
  )
  expect(signupSourceLabel({ landing: 'lead' })).toBe('도입 문의')
  expect(signupSourceLabel(null)).toBe('-')
})

it('utm_source 없이 medium만 있으면 referrer 호스트를 보여준다', async () => {
  const { signupSourceLabel } = await import('../signup-source')
  expect(
    signupSourceLabel({ landing: 'lead', utm_medium: 'cpc', referrer: 'https://example.com/path' })
  ).toBe('도입 문의 · example.com')
})

import { isTrackablePath, normalizePageLocation, normalizeReferrer } from '../analytics'

describe('isTrackablePath', () => {
  it.each(['/', '/recruiting', '/signup', '/my-deck', '/settings/billing', '/settings/billing/'])(
    '%s 허용',
    (p) => expect(isTrackablePath(p)).toBe(true)
  )
  it.each(['/d/recruiting/x', '/d', '/admin', '/admin/users', '/settings', '/settings/payments'])(
    '%s 차단',
    (p) => expect(isTrackablePath(p)).toBe(false)
  )
})

describe('normalizePageLocation', () => {
  const o = 'https://workdeck.work'
  it('허용 utm 만 남기고 다른 쿼리는 버린다', () => {
    expect(
      normalizePageLocation(o, '/recruiting', '?utm_source=a&spaceId=1&redirectTo=/x&subscribe=y')
    ).toBe(`${o}/recruiting?utm_source=a`)
  })
  it("'@' 가 든 utm 값은 버린다", () => {
    expect(normalizePageLocation(o, '/', '?utm_source=a@b.com&utm_medium=email')).toBe(
      `${o}/?utm_medium=email`
    )
  })
  it('utm 값은 100자로 자른다', () => {
    const out = normalizePageLocation(o, '/', `?utm_term=${'x'.repeat(150)}`)
    expect(out).toBe(`${o}/?utm_term=${'x'.repeat(100)}`)
  })
  it('쿼리가 없으면 ? 를 붙이지 않는다', () => {
    expect(normalizePageLocation(o, '/a', '')).toBe(`${o}/a`)
  })
})

describe('normalizeReferrer', () => {
  const cur = 'https://app.workdeck.work'
  it('같은 사이트는 오리진+pathname', () => {
    expect(normalizeReferrer('https://workdeck.work/pricing?x=1#h', cur)).toBe(
      'https://workdeck.work/pricing'
    )
    expect(normalizeReferrer('https://app.workdeck.work/my-deck?spaceId=1', cur)).toBe(
      'https://app.workdeck.work/my-deck'
    )
  })
  it('외부는 오리진만', () => {
    expect(normalizeReferrer('https://www.google.com/search?q=a@b.com', cur)).toBe(
      'https://www.google.com'
    )
  })
  it('없거나 잘못되면 빈 문자열', () => {
    expect(normalizeReferrer('', cur)).toBe('')
    expect(normalizeReferrer('not a url', cur)).toBe('')
  })
})

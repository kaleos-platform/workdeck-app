import { siteVerification } from '../seo'

const NAMES = ['GOOGLE_SITE_VERIFICATION', 'NAVER_SITE_VERIFICATION', 'BING_SITE_VERIFICATION']
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]))

beforeEach(() => NAMES.forEach((n) => delete process.env[n]))
afterAll(() =>
  NAMES.forEach((n) =>
    saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n])
  )
)

describe('siteVerification', () => {
  it('미설정·빈값·공백은 undefined', () => {
    expect(siteVerification()).toBeUndefined()
    process.env.GOOGLE_SITE_VERIFICATION = ''
    process.env.NAVER_SITE_VERIFICATION = '   '
    expect(siteVerification()).toBeUndefined()
  })

  it('설정된 값만 출력한다', () => {
    process.env.NAVER_SITE_VERIFICATION = ' naver-token '
    expect(siteVerification()).toEqual({ other: { 'naver-site-verification': 'naver-token' } })
    process.env.GOOGLE_SITE_VERIFICATION = 'g-token'
    process.env.BING_SITE_VERIFICATION = 'b-token'
    expect(siteVerification()).toEqual({
      google: 'g-token',
      other: { 'naver-site-verification': 'naver-token', 'msvalidate.01': 'b-token' },
    })
  })
})

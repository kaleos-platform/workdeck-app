/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceCredential: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) } },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  decryptField: jest.fn((_p: string, v: string) => v),
}))

import { prisma } from '@/lib/prisma'
import {
  GA4_ADMIN_BASE,
  GoogleApiError,
  GoogleOAuthError,
  exchangeGoogleCode,
  googleAuthorizeUrl,
  googleRequest,
  hasGoogleScopes,
  requiredGoogleScopes,
  targetUrl,
  verifyGoogleBrands,
  type GoogleCred,
} from '../google-marketing'

const A = 'https://www.googleapis.com/auth/'
const GA4 = [`${A}analytics.readonly`, `${A}analytics.edit`]
const GTM = [
  `${A}tagmanager.readonly`,
  `${A}tagmanager.edit.containers`,
  `${A}tagmanager.edit.containerversions`,
  `${A}tagmanager.publish`,
]
const cred = (secret: Partial<GoogleCred['secret']> = {}, brands = {}): GoogleCred => ({
  id: 'c1',
  secret: { clientId: 'cid', clientSecret: 'CSECRET', refreshToken: 'RT-secret', ...secret },
  config: { defaultBrand: 'a', brands: { a: { ga4_property_id: '111' }, ...brands } },
})
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response
let fetchMock: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('accessToken(승인 전)', () => {
  it('refresh token 이 없으면 승인 필요 오류 — fetch 호출 없음, lastError 에 남기지 않음', async () => {
    const url = targetUrl(
      GA4_ADMIN_BASE,
      'v1beta/properties/111',
      { brand: 'a', ga4_property_id: '111', gtm_account_id: '', gtm_container_id: '' },
      'ga4-admin'
    )
    const err = await googleRequest(cred({ refreshToken: undefined }), 'GET', url).catch(
      (e: GoogleApiError) => e
    )
    expect(err).toBeInstanceOf(GoogleApiError)
    const apiErr = err as GoogleApiError
    expect(apiErr.message).toBe('Google 연결(승인)이 필요합니다')
    expect(apiErr.record).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.spaceCredential.update).not.toHaveBeenCalled()
  })
})

describe('requiredGoogleScopes', () => {
  it('GTM 브랜드가 없으면 GA4 범위만', () => {
    expect(requiredGoogleScopes(cred().config)).toEqual(GA4)
  })
  it('GTM 이 설정된 브랜드가 하나라도 있으면 tagmanager 범위를 더한다', () => {
    const c = cred({}, { b: { ga4_property_id: '2', gtm_account_id: '3', gtm_container_id: '4' } })
    expect(requiredGoogleScopes(c.config)).toEqual([...GA4, ...GTM])
  })
  it('hasGoogleScopes: 필요한 범위가 모두 있어야 true(초과는 허용)', () => {
    expect(hasGoogleScopes([...GA4, 'openid'], GA4)).toBe(true)
    expect(hasGoogleScopes([GA4[0]], GA4)).toBe(false)
    expect(hasGoogleScopes(undefined, GA4)).toBe(false)
  })
})

describe('googleAuthorizeUrl', () => {
  it('offline·consent·include_granted_scopes 와 redirect_uri·state 를 담는다', () => {
    const u = new URL(googleAuthorizeUrl('cid-1', GA4, 'STATE', 'https://app.test/cb'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'cid-1',
      redirect_uri: 'https://app.test/cb',
      response_type: 'code',
      scope: GA4.join(' '),
      state: 'STATE',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })
  })
})

describe('exchangeGoogleCode', () => {
  it('승인 코드로 토큰을 받고 scope 를 나눈다(요청 본문은 authorization_code)', async () => {
    fetchMock.mockResolvedValue(
      json({ access_token: 'AT', refresh_token: 'RT', scope: `${GA4.join(' ')} openid` })
    )
    const t = await exchangeGoogleCode('cid', 'cs', 'CODE', 'https://app.test/cb')
    expect(t).toEqual({ accessToken: 'AT', refreshToken: 'RT', scopes: [...GA4, 'openid'] })
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(Object.fromEntries(body)).toEqual({
      client_id: 'cid',
      client_secret: 'cs',
      code: 'CODE',
      redirect_uri: 'https://app.test/cb',
      grant_type: 'authorization_code',
    })
  })

  it('refresh token 이 없으면 undefined 로 돌려준다(호출부가 error 처리)', async () => {
    fetchMock.mockResolvedValue(json({ access_token: 'AT', scope: GA4.join(' ') }))
    expect((await exchangeGoogleCode('c', 's', 'x', 'u')).refreshToken).toBeUndefined()
  })

  it('실패 오류에는 단계·상태·허용된 코드만 — 응답 본문의 토큰·설명은 들어가지 않는다', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: 'invalid_grant',
          error_description: 'Bad code LEAK-refresh-token-xyz client_secret=CSECRET',
          refresh_token: 'LEAK-refresh-token-xyz',
        },
        400
      )
    )
    const err = await exchangeGoogleCode('cid', 'CSECRET', 'CODE', 'u').catch((e) => e)
    expect(err).toBeInstanceOf(GoogleOAuthError)
    expect(err.message).toBe('Google 토큰 교환 실패 (HTTP 400): invalid_grant')
    expect(JSON.stringify(err)).not.toMatch(/LEAK|CSECRET/)
    expect(err.stack).not.toMatch(/LEAK/)
  })

  it('허용 목록 밖 코드는 상태 기반 코드로 바꾼다', async () => {
    fetchMock.mockResolvedValue(json({ error: 'LEAK-weird-code <script>' }, 500))
    const err = await exchangeGoogleCode('c', 's', 'x', 'u').catch((e) => e)
    expect(err.message).toBe('Google 토큰 교환 실패 (HTTP 500): server_error')
  })

  it('네트워크 오류는 원 메시지를 버린다', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNRESET client_secret=CSECRET'))
    const err = await exchangeGoogleCode('c', 'CSECRET', 'x', 'u').catch((e) => e)
    expect(err.message).toBe('Google 토큰 교환 실패: network')
  })

  it('access_token 이 없는 200 응답은 invalid_response', async () => {
    fetchMock.mockResolvedValue(json({ refresh_token: 'RT' }))
    const err = await exchangeGoogleCode('c', 's', 'x', 'u').catch((e) => e)
    expect(err.message).toBe('Google 토큰 교환 실패: invalid_response')
  })
})

describe('verifyGoogleBrands', () => {
  it('브랜드마다 GA4 속성을 GET 1회씩 조회한다(Bearer 는 받은 토큰)', async () => {
    fetchMock.mockResolvedValue(json({ name: 'properties/111' }))
    const c = cred({}, { b: { ga4_property_id: '222' } })
    await verifyGoogleBrands(c, 'AT-given')
    const urls = fetchMock.mock.calls.map((x) => String(x[0]))
    expect(urls).toEqual([
      'https://analyticsadmin.googleapis.com/v1beta/properties/111',
      'https://analyticsadmin.googleapis.com/v1beta/properties/222',
    ])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer AT-given' },
    })
  })

  it('토큰을 안 주면 refresh token 으로 access token 을 받아 쓴다', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'AT-refreshed' }))
      .mockResolvedValue(json({ name: 'properties/111' }))
    await verifyGoogleBrands(cred())
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer AT-refreshed')
  })

  it('속성 접근 거부는 상태·코드만 담은 GoogleOAuthError — 본문·토큰 없음', async () => {
    fetchMock.mockResolvedValue(
      json(
        { error: { message: 'User LEAK-body-text has no access', status: 'PERMISSION_DENIED' } },
        403
      )
    )
    const err = await verifyGoogleBrands(cred(), 'AT-secret-token').catch((e) => e)
    expect(err).toBeInstanceOf(GoogleOAuthError)
    expect(err.message).toBe('Google 속성 확인 실패 (HTTP 403): forbidden')
    expect(JSON.stringify(err) + err.message + err.stack).not.toMatch(/LEAK|AT-secret-token/)
  })

  it('refresh token 도 없고 토큰도 안 주면 승인 필요 오류(fetch 없음)', async () => {
    await expect(verifyGoogleBrands(cred({ refreshToken: undefined }))).rejects.toThrow(
      'Google 연결(승인)이 필요합니다'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

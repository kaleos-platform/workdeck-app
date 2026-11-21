/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { fakeDb } from '@/lib/integrations/__tests__/google-fake-db'

jest.mock('@/lib/prisma', () => ({
  prisma: jest.requireActual('@/lib/integrations/__tests__/google-fake-db').fakePrisma,
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: (_p: string, s: string) => ({ encrypted: s, iv: 'v1' }),
  decryptField: (_p: string, e: string) => e,
}))
jest.mock('@/lib/agent/audit', () => ({ maskSecrets: (s: string) => s }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceAdmin: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/agent/integrations/google-marketing', () => ({
  ...jest.requireActual('@/lib/agent/integrations/google-marketing'),
  exchangeGoogleCode: jest.fn(),
  verifyGoogleBrands: jest.fn(),
}))

import { getUser } from '@/hooks/use-user'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import {
  GOOGLE_NONCE_COOKIE,
  GOOGLE_STATE_PURPOSE,
  GoogleOAuthError,
  exchangeGoogleCode,
  requiredGoogleScopes,
  verifyGoogleBrands,
} from '@/lib/agent/integrations/google-marketing'
import { createOAuthState, verifyOAuthState } from '@/lib/integrations/oauth-state'
import { buildAppUrl, getAppOrigin } from '@/lib/domain'
import { POST as install } from '../install/route'
import { GET as callback } from '../callback/route'

const SP = 'sp1'
const U = 'user1'
const CID = 'cid-1234567'
const GA4 = requiredGoogleScopes({ brands: {} })
const WITH_GTM = requiredGoogleScopes({
  brands: { a: { ga4_property_id: '1', gtm_account_id: '2', gtm_container_id: '3' } },
})
const mockedUser = getUser as jest.Mock
const mockedAdmin = requireSpaceAdmin as jest.Mock
const mockedAal2 = requireAal2 as jest.Mock
const mockedExchange = exchangeGoogleCode as jest.Mock
const mockedVerify = verifyGoogleBrands as jest.Mock
const forbidden = () => ({
  error: NextResponse.json({ message: '권한이 없습니다' }, { status: 403 }),
})

function seedRow(config: Record<string, unknown> = {}, secret: Record<string, unknown> = {}) {
  fakeDb.seed(
    SP,
    { clientId: CID, clientSecret: 'CSECRET-xyz', ...secret },
    {
      defaultBrand: 'a',
      brands: { a: { ga4_property_id: '1' } },
      credVersion: 1,
      status: 'needs_auth',
      ...config,
    }
  )
}

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'
  fakeDb.reset()
  jest.clearAllMocks()
  mockedUser.mockResolvedValue({ id: U })
  mockedAdmin.mockResolvedValue({ userId: U, role: 'ADMIN' })
  mockedAal2.mockResolvedValue(null)
  mockedVerify.mockResolvedValue(undefined)
  mockedExchange.mockResolvedValue({ accessToken: 'AT1', refreshToken: 'RT1', scopes: GA4 })
})

function installReq(init: { origin?: string | null; spaceId?: string } = {}) {
  const body = new URLSearchParams({ spaceId: init.spaceId ?? SP })
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (init.origin !== null) headers.origin = init.origin ?? getAppOrigin()
  return new NextRequest(buildAppUrl('/api/integrations/google/install'), {
    method: 'POST',
    headers,
    body,
  })
}

describe('install', () => {
  it('Origin 이 앱 도메인과 다르면 거부한다', async () => {
    seedRow()
    expect((await install(installReq({ origin: 'https://evil.example' }))).status).toBe(403)
    expect((await install(installReq({ origin: null }))).status).toBe(403)
    expect(mockedAdmin).not.toHaveBeenCalled()
  })

  it('MEMBER(권한 없음)는 403, aal1 은 차단한다', async () => {
    seedRow()
    mockedAdmin.mockResolvedValue(forbidden())
    expect((await install(installReq())).status).toBe(403)
    mockedAdmin.mockResolvedValue({ userId: U, role: 'ADMIN' })
    mockedAal2.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
    const res = await install(installReq())
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
  })

  it('자격증명(클라이언트 ID·시크릿)이 없으면 400', async () => {
    expect((await install(installReq())).status).toBe(400) // 행 없음
    seedRow({}, { clientSecret: '' })
    expect((await install(installReq())).status).toBe(400)
  })

  it('성공하면 동의 주소(JSON url) + nonce 쿠키 + 서명 state', async () => {
    seedRow()
    const res = await install(installReq())
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    const loc = new URL(((await res.json()) as { url: string }).url)
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(loc.searchParams.get('client_id')).toBe(CID)
    expect(loc.searchParams.get('response_type')).toBe('code')
    expect(loc.searchParams.get('redirect_uri')).toBe(
      buildAppUrl('/api/integrations/google/callback')
    )
    expect(loc.searchParams.get('access_type')).toBe('offline')
    expect(loc.searchParams.get('prompt')).toBe('consent')
    expect(loc.searchParams.get('include_granted_scopes')).toBe('true')
    expect(loc.searchParams.get('scope')!.split(' ')).toEqual(GA4)
    expect(loc.searchParams.get('scope')).not.toContain('tagmanager')
    expect(verifyOAuthState(GOOGLE_STATE_PURPOSE, loc.searchParams.get('state')!)).toMatchObject({
      spaceId: SP,
      userId: U,
      clientId: CID,
    })
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain(`${GOOGLE_NONCE_COOKIE}=`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toContain('Path=/api/integrations/google')
  })

  it('GTM 이 설정된 브랜드가 있으면 tagmanager scope 를 더한다', async () => {
    seedRow({
      brands: {
        a: { ga4_property_id: '1' },
        b: { ga4_property_id: '4', gtm_account_id: '2', gtm_container_id: '3' },
      },
    })
    const loc = new URL(((await (await install(installReq())).json()) as { url: string }).url)
    expect(loc.searchParams.get('scope')!.split(' ')).toEqual(WITH_GTM)
  })

  it('SLACK_SIGNING_SECRET 이 없으면 503', async () => {
    seedRow()
    delete process.env.SLACK_SIGNING_SECRET
    expect((await install(installReq())).status).toBe(503)
  })
})

function cbReq(
  opts: { state?: string; nonce?: string | null; extra?: Record<string, string> } = {}
) {
  const made = createOAuthState(GOOGLE_STATE_PURPOSE, { spaceId: SP, userId: U, clientId: CID })!
  const q = new URLSearchParams({
    state: opts.state ?? made.state,
    code: 'CODE-1',
    ...opts.extra,
  })
  const headers: Record<string, string> = {}
  const nonce = opts.nonce === undefined ? made.nonce : opts.nonce
  if (nonce) headers.cookie = `${GOOGLE_NONCE_COOKIE}=${nonce}`
  return new NextRequest(`${buildAppUrl('/api/integrations/google/callback')}?${q}`, { headers })
}

const outcome = (res: Response) => {
  const loc = new URL(res.headers.get('location')!)
  expect(loc.pathname).toBe('/settings/integrations')
  expect(loc.searchParams.get('open')).toBe('google-marketing')
  return { google: loc.searchParams.get('google'), spaceId: loc.searchParams.get('spaceId') }
}
const clearsNonce = (res: Response) => {
  const c = res.headers.get('set-cookie')!
  expect(c).toContain(`${GOOGLE_NONCE_COOKIE}=;`)
  expect(c).toMatch(/Max-Age=0/i)
  expect(c).toContain('Path=/api/integrations/google')
}

describe('callback', () => {
  it('state 위조·카페24 state 는 expired 이고 spaceId 를 싣지 않는다', async () => {
    seedRow()
    const res = await callback(cbReq({ state: 'forged.state' }))
    expect(outcome(res)).toEqual({ google: 'expired', spaceId: null })
    clearsNonce(res)
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('다른 사용자는 forbidden', async () => {
    seedRow()
    mockedUser.mockResolvedValue({ id: 'someone-else' })
    const res = await callback(cbReq())
    expect(outcome(res)).toEqual({ google: 'forbidden', spaceId: SP })
    clearsNonce(res)
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('nonce 쿠키가 없거나 다르면 expired', async () => {
    seedRow()
    for (const nonce of [null, 'wrong-nonce']) {
      const res = await callback(cbReq({ nonce }))
      expect(outcome(res).google).toBe('expired')
      clearsNonce(res)
    }
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('ADMIN 이 아니면 forbidden, aal1 이면 mfa_required', async () => {
    seedRow()
    mockedAdmin.mockResolvedValue(forbidden())
    expect(outcome(await callback(cbReq())).google).toBe('forbidden')
    mockedAdmin.mockResolvedValue({ userId: U, role: 'ADMIN' })
    mockedAal2.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('mfa_required')
    clearsNonce(res)
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('사용자가 거부하면 denied', async () => {
    seedRow()
    const res = await callback(cbReq({ extra: { error: 'access_denied' } }))
    expect(outcome(res).google).toBe('denied')
    clearsNonce(res)
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('승인 도중 clientId 가 바뀌었으면 저장하지 않고 error', async () => {
    seedRow({}, { clientId: 'changed-client-id' })
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('error')
    clearsNonce(res)
    expect(mockedExchange).not.toHaveBeenCalled()
    expect(fakeDb.secret.refreshToken).toBeUndefined()
  })

  it('행이 삭제됐으면 error', async () => {
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('error')
    clearsNonce(res)
  })

  it('refresh token 이 발급되지 않으면 error 이고 기존 값을 건드리지 않는다', async () => {
    seedRow({ status: 'connected' }, { refreshToken: 'OLD-RT' })
    mockedExchange.mockResolvedValue({ accessToken: 'AT1', scopes: GA4 })
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('error')
    clearsNonce(res)
    expect(fakeDb.secret.refreshToken).toBe('OLD-RT')
    expect(fakeDb.row.config.credVersion).toBe(1)
  })

  it('토큰 교환 실패: error, lastError 에는 상태·코드만(토큰·본문 없음)', async () => {
    seedRow()
    mockedExchange.mockRejectedValue(new GoogleOAuthError('토큰 교환', 'invalid_grant', 400))
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('error')
    clearsNonce(res)
    expect(fakeDb.row.lastError).toBe('Google 토큰 교환 실패 (HTTP 400): invalid_grant')
  })

  it('필수 범위를 못 받으면 토큰은 저장하되 needs_auth + scope_missing', async () => {
    seedRow({
      brands: { a: { ga4_property_id: '1', gtm_account_id: '2', gtm_container_id: '3' } },
    })
    mockedExchange.mockResolvedValue({ accessToken: 'AT1', refreshToken: 'RT1', scopes: GA4 })
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('scope_missing')
    clearsNonce(res)
    expect(fakeDb.secret.refreshToken).toBe('RT1')
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_auth', scopes: GA4 })
    expect(mockedVerify).not.toHaveBeenCalled()
  })

  it('속성 접근 실패: 토큰 유지 + needs_check + lastError(코드만) + property_denied', async () => {
    seedRow()
    mockedVerify.mockRejectedValue(new GoogleOAuthError('속성 확인', 'forbidden', 403))
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('property_denied')
    clearsNonce(res)
    expect(fakeDb.secret.refreshToken).toBe('RT1')
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_check', scopes: GA4 })
    expect(fakeDb.row.lastError).toBe('Google 속성 확인 실패 (HTTP 403): forbidden')
  })

  it('정상: 토큰·scopes 저장, 속성 확인 뒤 connected + connectedAt, 버전은 저장·승격으로 2 올라간다', async () => {
    seedRow({ status: 'needs_auth', lastBrand: undefined }, { refreshToken: undefined })
    fakeDb.row.lastError = 'old error'
    const res = await callback(cbReq())
    expect(outcome(res)).toEqual({ google: 'connected', spaceId: SP })
    clearsNonce(res)
    expect(fakeDb.secret).toMatchObject({
      clientId: CID,
      clientSecret: 'CSECRET-xyz',
      refreshToken: 'RT1',
    })
    expect(fakeDb.row.config).toMatchObject({
      status: 'connected',
      scopes: GA4,
      credVersion: 3,
      defaultBrand: 'a',
      brands: { a: { ga4_property_id: '1' } },
    })
    expect(typeof fakeDb.row.config.connectedAt).toBe('string')
    expect(fakeDb.row.lastError).toBeNull()
    // 토큰 교환은 install 과 같은 redirect_uri 로
    expect(mockedExchange).toHaveBeenCalledWith(
      CID,
      'CSECRET-xyz',
      'CODE-1',
      buildAppUrl('/api/integrations/google/callback')
    )
    // 속성 확인에는 교환으로 받은 access token 을 쓴다
    expect(mockedVerify.mock.calls[0][1]).toBe('AT1')
  })

  it('credVersion 키가 없는 기존 행(수동 토큰)도 첫 쓰기가 성공한다', async () => {
    fakeDb.seed(
      SP,
      { clientId: CID, clientSecret: 'CSECRET-xyz', refreshToken: 'MANUAL-RT' },
      { defaultBrand: 'a', brands: { a: { ga4_property_id: '1' } } }
    )
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('connected')
    expect(fakeDb.secret.refreshToken).toBe('RT1')
    expect(fakeDb.row.config.credVersion).toBe(2)
  })

  it('저장·콜백 교차: 같은 버전을 읽은 사이 저장이 먼저 끝나면 콜백은 다시 읽어 재시도하고 새 브랜드를 보존한다', async () => {
    seedRow()
    let once = true
    fakeDb.beforeUpdateMany = () => {
      if (!once) return
      once = false
      // 콜백이 쓰기 직전에 저장(PUT)이 끼어들어 버전을 올리고 브랜드를 바꾼다.
      fakeDb.row.config = {
        ...fakeDb.row.config,
        brands: { a: { ga4_property_id: '1' }, b: { ga4_property_id: '9' } },
        credVersion: 2,
      }
    }
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('connected')
    expect(fakeDb.secret.refreshToken).toBe('RT1')
    expect(Object.keys(fakeDb.row.config.brands as object)).toEqual(['a', 'b']) // 새 브랜드 보존
    expect(fakeDb.row.config.credVersion).toBe(4)
  })

  it('콜백 승인(GA4 범위만) 직후 GTM 브랜드 저장이 먼저 끝나면 재시도에서 scope_missing·needs_auth', async () => {
    seedRow()
    let once = true
    fakeDb.beforeUpdateMany = () => {
      if (!once) return
      once = false
      fakeDb.row.config = {
        ...fakeDb.row.config,
        brands: { a: { ga4_property_id: '1', gtm_account_id: '2', gtm_container_id: '3' } },
        credVersion: 2,
      }
    }
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('scope_missing')
    expect(fakeDb.secret.refreshToken).toBe('RT1') // 토큰은 저장
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_auth', scopes: GA4 })
    expect(mockedVerify).not.toHaveBeenCalled()
  })

  it('속성 확인 뒤 승격 직전에 GTM 이 추가되면 승격하지 않고 needs_auth + scope_missing', async () => {
    seedRow()
    mockedVerify.mockImplementation(async () => {
      fakeDb.row.config = {
        ...fakeDb.row.config,
        brands: { a: { ga4_property_id: '1', gtm_account_id: '2', gtm_container_id: '3' } },
        credVersion: 3,
      }
    })
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('scope_missing')
    expect(fakeDb.row.config.status).toBe('needs_auth')
  })

  it('속성 확인 뒤 승격 직전에 GA4 속성이 바뀌면 승격하지 않고 error(needs_check 유지)', async () => {
    seedRow()
    mockedVerify.mockImplementation(async () => {
      fakeDb.row.config = {
        ...fakeDb.row.config,
        brands: { a: { ga4_property_id: '77' } },
        credVersion: 3,
      }
    })
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('error')
    expect(fakeDb.row.config.status).toBe('needs_check')
  })

  it('행이 도중에 삭제되면 error', async () => {
    seedRow()
    fakeDb.beforeUpdateMany = () => {
      fakeDb.rows = []
    }
    expect(outcome(await callback(cbReq())).google).toBe('error')
  })

  it('쓰기를 계속 지면(버전 경합 반복) error 로 끝난다', async () => {
    seedRow()
    fakeDb.beforeUpdateMany = () => {
      fakeDb.row.config = {
        ...fakeDb.row.config,
        credVersion: (fakeDb.row.config.credVersion as number) + 1,
      }
    }
    const res = await callback(cbReq())
    expect(outcome(res).google).toBe('error')
    clearsNonce(res)
  })
})

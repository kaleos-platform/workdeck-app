/** @jest-environment node */
import { NextRequest } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { isAal2Fresh } from '@/lib/auth/mfa'
import { exchangeGoogleCode, GoogleOAuthError } from '@/lib/agent/integrations/google-marketing'
import {
  readPlatformGoogle,
  recordPlatformError,
  writePlatformGoogleIf,
} from '@/lib/admin/platform-google'
import { fetchMeasurementId } from '@/lib/admin/platform-ga4'
import { createOAuthState } from '@/lib/integrations/oauth-state'
import { GET } from '../route'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ isAal2Fresh: jest.fn() }))
jest.mock('@/lib/agent/integrations/google-marketing', () => ({
  ...jest.requireActual('@/lib/agent/integrations/google-marketing'),
  exchangeGoogleCode: jest.fn(),
}))
jest.mock('@/lib/admin/platform-google', () => ({
  PLATFORM_STATE_PURPOSE: 'admin-google-analytics',
  PLATFORM_NONCE_COOKIE: 'admin_google_oauth_nonce',
  PLATFORM_COOKIE_PATH: '/api/admin/platform/google',
  PLATFORM_CALLBACK_PATH: '/api/admin/platform/google/callback',
  PLATFORM_SCOPES: ['https://www.googleapis.com/auth/analytics.readonly'],
  readPlatformGoogle: jest.fn(),
  recordPlatformError: jest.fn(),
  writePlatformGoogleIf: jest.fn(),
}))
jest.mock('@/lib/admin/platform-ga4', () => ({ fetchMeasurementId: jest.fn() }))

const ADMIN = 'https://admin.workdeck.work'
const READONLY = 'https://www.googleapis.com/auth/analytics.readonly'
const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  lastError: null,
  secret: { clientId: 'cid', clientSecret: 'sec', ...over },
  config: { propertyId: '1', streamId: '2', status: 'needs_auth', credVersion: 1 },
})

function request(opts: {
  state?: string | null
  nonce?: string | null
  query?: Record<string, string>
}) {
  const q = new URLSearchParams({ code: 'code1', ...opts.query })
  if (opts.state) q.set('state', opts.state)
  return new NextRequest(`${ADMIN}/api/admin/platform/google/callback?${q}`, {
    headers: opts.nonce ? { cookie: `admin_google_oauth_nonce=${opts.nonce}` } : {},
  })
}

function fresh(userId = 'op1', clientId = 'cid') {
  return createOAuthState('admin-google-analytics', { spaceId: 'platform', userId, clientId })!
}

const outcome = (res: Response) => new URL(res.headers.get('location')!).searchParams.get('google')

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.ADMIN_REQUIRE_MFA
  process.env.SLACK_SIGNING_SECRET = 'signing'
  process.env.NEXT_PUBLIC_ADMIN_URL = ADMIN
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op1' } })
  ;(isAal2Fresh as jest.Mock).mockResolvedValue(true)
  ;(readPlatformGoogle as jest.Mock).mockReset() // 쓰지 않고 남은 Once 큐가 다음 테스트로 새지 않게
  // 첫 읽기 = 승인 전 행, 이후 읽기 = 토큰 저장 뒤 행(승격 전 재검증)
  ;(readPlatformGoogle as jest.Mock).mockResolvedValueOnce(row()).mockResolvedValue({
    ...row({ refreshToken: 'rt' }),
    config: {
      propertyId: '1',
      streamId: '2',
      status: 'needs_check',
      scopes: [READONLY],
      credVersion: 2,
    },
  })
  ;(exchangeGoogleCode as jest.Mock).mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    scopes: [READONLY],
  })
  ;(writePlatformGoogleIf as jest.Mock).mockResolvedValue(true)
  ;(fetchMeasurementId as jest.Mock).mockResolvedValue('G-5F8G9Y4VHW')
})

describe('거부 경로(모두 nonce 쿠키 삭제 + admin 오리진 리다이렉트)', () => {
  async function expectDenied(res: Response, code: string) {
    expect(res.status).toBe(307)
    expect(res.headers.get('location')!.startsWith(`${ADMIN}/admin/integrations?google=`)).toBe(
      true
    )
    expect(outcome(res)).toBe(code)
    expect(res.headers.get('set-cookie')).toMatch(/admin_google_oauth_nonce=;/)
    expect(res.headers.get('set-cookie')).toMatch(/Path=\/api\/admin\/platform\/google/)
    expect(exchangeGoogleCode).not.toHaveBeenCalled()
  }

  test('state 없음·위조', async () => {
    await expectDenied(await GET(request({ state: null, nonce: 'n' })), 'expired')
    const { state, nonce } = fresh()
    await expectDenied(await GET(request({ state: state.slice(0, -2) + 'xx', nonce })), 'expired')
  })

  test('고객용 state(purpose 교차)는 거부', async () => {
    const c = createOAuthState('google-marketing', {
      spaceId: 'platform',
      userId: 'op1',
      clientId: 'cid',
    })!
    await expectDenied(await GET(request({ state: c.state, nonce: c.nonce })), 'expired')
  })

  test('다른 사용자', async () => {
    const { state, nonce } = fresh('someone-else')
    await expectDenied(await GET(request({ state, nonce })), 'forbidden')
  })

  test('비운영자', async () => {
    ;(requireOperator as jest.Mock).mockResolvedValue({ ok: false, reason: 'NOT_OPERATOR' })
    const { state, nonce } = fresh()
    await expectDenied(await GET(request({ state, nonce })), 'forbidden')
  })

  test('nonce 없음·불일치', async () => {
    const { state } = fresh()
    await expectDenied(await GET(request({ state, nonce: null })), 'expired')
    await expectDenied(await GET(request({ state, nonce: 'other' })), 'expired')
  })

  test('aal2 없음 — ADMIN_REQUIRE_MFA=false 여도 거부', async () => {
    process.env.ADMIN_REQUIRE_MFA = 'false'
    ;(isAal2Fresh as jest.Mock).mockResolvedValue(false)
    const { state, nonce } = fresh()
    await expectDenied(await GET(request({ state, nonce })), 'mfa_required')
  })

  test('사용자 거부(error=access_denied)', async () => {
    const { state, nonce } = fresh()
    await expectDenied(
      await GET(request({ state, nonce, query: { error: 'access_denied' } })),
      'denied'
    )
  })

  test('승인 도중 clientId 변경', async () => {
    ;(readPlatformGoogle as jest.Mock).mockReset().mockResolvedValue(row({ clientId: 'changed' }))
    const { state, nonce } = fresh()
    await expectDenied(await GET(request({ state, nonce })), 'error')
  })
})

test('nonce 재사용: 성공 응답도 쿠키를 지워 같은 요청을 다시 보낼 수 없다', async () => {
  const { state, nonce } = fresh()
  const res = await GET(request({ state, nonce }))
  expect(outcome(res)).toBe('connected')
  expect(res.headers.get('set-cookie')).toMatch(/admin_google_oauth_nonce=;/)
})

test('scope 부족이면 토큰은 needs_auth 로 저장하고 scope_missing', async () => {
  ;(exchangeGoogleCode as jest.Mock).mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    scopes: ['https://www.googleapis.com/auth/userinfo.email'],
  })
  const { state, nonce } = fresh()
  const res = await GET(request({ state, nonce }))
  expect(outcome(res)).toBe('scope_missing')
  expect((writePlatformGoogleIf as jest.Mock).mock.calls[0][2]).toMatchObject({
    status: 'needs_auth',
  })
  expect(fetchMeasurementId).not.toHaveBeenCalled()
})

test('필수 scope 외 추가 권한이 섞여도 통과하고 scopes 는 반환 그대로 저장', async () => {
  const extra = [READONLY, 'https://www.googleapis.com/auth/tagmanager.edit.containers']
  ;(exchangeGoogleCode as jest.Mock).mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    scopes: extra,
  })
  const { state, nonce } = fresh()
  const res = await GET(request({ state, nonce }))
  expect(outcome(res)).toBe('connected')
  expect((writePlatformGoogleIf as jest.Mock).mock.calls[0][2]).toMatchObject({
    scopes: extra,
    status: 'needs_check',
  })
})

test('정상: needs_check 저장 → 스트림 조회 → connected 승격 + 감사 로그 2건(비밀값 없음)', async () => {
  const { state, nonce } = fresh()
  const res = await GET(request({ state, nonce }))
  expect(outcome(res)).toBe('connected')
  const calls = (writePlatformGoogleIf as jest.Mock).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][2]).toMatchObject({ status: 'needs_check' })
  expect(calls[1][2]).toMatchObject({ status: 'connected', connectedBy: 'op1' })
  for (const c of calls) {
    expect(c[3].action).toBe('platform.google.connect')
    expect(JSON.stringify(c[3])).not.toMatch(/rt|sec|code1/)
  }
  expect(fetchMeasurementId).toHaveBeenCalledWith('at', '1', '2')
})

test('스트림 조회 실패면 토큰은 유지하고 property_denied + 오류 한 줄(허용 코드만)', async () => {
  ;(fetchMeasurementId as jest.Mock).mockRejectedValue(
    new GoogleOAuthError('스트림 조회', 'forbidden', 403)
  )
  const { state, nonce } = fresh()
  const res = await GET(request({ state, nonce }))
  expect(outcome(res)).toBe('property_denied')
  expect(recordPlatformError).toHaveBeenCalledWith(
    'r1',
    'Google 스트림 조회 실패 (HTTP 403): forbidden'
  )
})

test('토큰 교환 실패는 error', async () => {
  ;(exchangeGoogleCode as jest.Mock).mockRejectedValue(
    new GoogleOAuthError('토큰 교환', 'invalid_grant', 400)
  )
  const { state, nonce } = fresh()
  expect(outcome(await GET(request({ state, nonce })))).toBe('error')
})

test('예외(DB 등)가 나도 쿠키를 지우고 결과 화면으로 돌려보낸다', async () => {
  ;(readPlatformGoogle as jest.Mock).mockRejectedValue(new Error('db down'))
  const { state, nonce } = fresh()
  const res = await GET(request({ state, nonce }))
  expect(outcome(res)).toBe('error')
  expect(res.headers.get('set-cookie')).toMatch(/admin_google_oauth_nonce=;/)
})

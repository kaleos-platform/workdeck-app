/** @jest-environment node */
import { NextResponse, type NextRequest } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { requireFreshAal2 } from '@/lib/auth/mfa'
import { readPlatformGoogle, registerPlatformGoogle } from '@/lib/admin/platform-google'
import { loadPlatformGoogleView } from '@/lib/admin/platform-ga4'
import { GET, PUT } from '../route'
import { POST as install } from '../install/route'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireFreshAal2: jest.fn() }))
jest.mock('@/lib/admin/platform-google', () => ({
  PLATFORM_STATE_PURPOSE: 'admin-google-analytics',
  PLATFORM_NONCE_COOKIE: 'admin_google_oauth_nonce',
  PLATFORM_COOKIE_PATH: '/api/admin/platform/google',
  PLATFORM_CALLBACK_PATH: '/api/admin/platform/google/callback',
  PLATFORM_SCOPES: ['https://www.googleapis.com/auth/analytics.readonly'],
  readPlatformGoogle: jest.fn(),
  registerPlatformGoogle: jest.fn(),
}))
jest.mock('@/lib/admin/platform-ga4', () => ({ loadPlatformGoogleView: jest.fn() }))

const ADMIN = 'https://admin.workdeck.work'
const put = (body: unknown) =>
  new Request(`${ADMIN}/api/admin/platform/google`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const valid = { clientId: 'c', clientSecret: 's', propertyId: '412345678', streamId: '9876543210' }
const post = (origin: string | null) =>
  new Request(`${ADMIN}/api/admin/platform/google/install`, {
    method: 'POST',
    headers: origin ? { origin } : {},
  }) as NextRequest
const notOperator = () =>
  (requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    response: NextResponse.json({}, { status: 404 }),
  })
const mfaDenied = () =>
  (requireFreshAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SLACK_SIGNING_SECRET = 'signing'
  process.env.NEXT_PUBLIC_ADMIN_URL = ADMIN
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op1' } })
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(null)
  ;(registerPlatformGoogle as jest.Mock).mockResolvedValue('ok')
  ;(loadPlatformGoogleView as jest.Mock).mockResolvedValue({
    registered: true,
    clientId: 'c',
    hasRefreshToken: true,
  })
  ;(readPlatformGoogle as jest.Mock).mockResolvedValue({
    id: 'r',
    secret: { clientId: 'c', clientSecret: 'TOPSECRET', refreshToken: 'REFRESH' },
    config: { propertyId: '1', streamId: '2', status: 'connected', credVersion: 1 },
  })
})

describe('비운영자 404(모든 라우트)', () => {
  beforeEach(notOperator)
  test('GET', async () => expect((await GET()).status).toBe(404))
  test('PUT', async () => {
    expect((await PUT(put(valid))).status).toBe(404)
    expect(registerPlatformGoogle).not.toHaveBeenCalled()
  })
  test('install', async () => expect((await install(post(ADMIN))).status).toBe(404))
})

describe('aal2 없음 403 (ADMIN_REQUIRE_MFA=false 여도 requireFreshAal2 로 강제)', () => {
  beforeEach(() => {
    process.env.ADMIN_REQUIRE_MFA = 'false'
    mfaDenied()
  })
  afterEach(() => delete process.env.ADMIN_REQUIRE_MFA)
  test('PUT', async () => {
    expect((await PUT(put(valid))).status).toBe(403)
    expect(registerPlatformGoogle).not.toHaveBeenCalled()
  })
  test('install', async () => expect((await install(post(ADMIN))).status).toBe(403))
})

describe('GET', () => {
  test('비밀값을 노출하지 않는다', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).not.toMatch(/clientSecret|refreshToken"|TOPSECRET|REFRESH/)
  })
})

describe('PUT', () => {
  test('저장 성공 — 서버가 operator id 를 넘긴다(감사 로그는 저장소 transaction 안)', async () => {
    const res = await PUT(put(valid))
    expect(res.status).toBe(200)
    expect(registerPlatformGoogle).toHaveBeenCalledWith(valid, 'op1')
  })
  test.each([
    ['측정 ID(G-) 입력', { ...valid, propertyId: 'G-5F8G9Y4VHW' }],
    ['스트림 ID 문자', { ...valid, streamId: 'abc' }],
    ['clientId 없음', { ...valid, clientId: '' }],
  ])('검증 실패 400: %s', async (_n, body) => {
    expect((await PUT(put(body))).status).toBe(400)
  })
  test('충돌 409', async () => {
    ;(registerPlatformGoogle as jest.Mock).mockResolvedValue('conflict')
    expect((await PUT(put(valid))).status).toBe(409)
  })
  test('시크릿 필요 400', async () => {
    ;(registerPlatformGoogle as jest.Mock).mockResolvedValue('secret_required')
    expect((await PUT(put(valid))).status).toBe(400)
  })
})

describe('install', () => {
  test('Origin 불일치 403', async () => {
    expect((await install(post('https://evil.example'))).status).toBe(403)
    expect((await install(post(null))).status).toBe(403)
  })

  test('정상: 동의 주소·scope·redirect_uri·nonce 쿠키 속성', async () => {
    const res = await install(post(ADMIN))
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    const u = new URL(url)
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/analytics.readonly')
    expect(u.searchParams.get('include_granted_scopes')).toBeNull()
    expect(u.searchParams.get('redirect_uri')).toBe(`${ADMIN}/api/admin/platform/google/callback`)
    const cookie = res.cookies.get('admin_google_oauth_nonce')!
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/admin/platform/google',
    })
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i)
    expect(url).not.toContain('TOPSECRET')
  })

  test('저장 전이면 400', async () => {
    ;(readPlatformGoogle as jest.Mock).mockResolvedValue(null)
    expect((await install(post(ADMIN))).status).toBe(400)
  })
})

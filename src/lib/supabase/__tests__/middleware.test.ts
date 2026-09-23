/** @jest-environment node */

const auth = { getUser: jest.fn(), getClaims: jest.fn() }
let cookieBridge: {
  setAll: (
    cookies: Array<{ name: string; value: string; options?: { maxAge?: number; path?: string } }>
  ) => void
}
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn((_url, _key, options) => {
    cookieBridge = options.cookies
    return { auth }
  }),
}))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('next/headers', () => ({ headers: async () => new Headers() }))
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { workspace: { findUnique: jest.fn() }, adRecord: { findFirst: jest.fn() } },
}))
jest.mock('@/lib/coupang-ads/queries', () => ({ queryKpi: jest.fn(), queryCampaigns: jest.fn() }))
jest.mock('@/components/dashboard/dashboard-client', () => ({ DashboardClient: () => null }))

import { NextRequest } from 'next/server'
import { updateSession } from '../middleware'
import { proxy } from '../../../../proxy'
import { getUser } from '@/hooks/use-user'
import { resolveWorkspace } from '@/lib/api-helpers'
import { queryKpi, queryCampaigns } from '@/lib/coupang-ads/queries'
import HomePage from '../../../../app/d/coupang-ads/page'

beforeEach(() => {
  jest.clearAllMocks()
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null })
  auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'user' } }, error: null })
})

test.each(['/d/coupang-ads', '/d/coupang-ads/campaigns/c1'])(
  '보호된 쿠팡 화면 %s만 서명 검증을 사용한다',
  async (path) => {
    const result = await updateSession(new NextRequest(`https://app.workdeck.work${path}`))
    expect(result).toHaveProperty('authenticated', true)
    expect(auth.getClaims).toHaveBeenCalledTimes(1)
    expect(auth.getUser).not.toHaveBeenCalled()
  }
)

test.each([
  '/login',
  '/d/coupang-ads/login',
  '/admin',
  '/api/campaigns',
  '/d/finance',
  '/d/coupang-ads/campaigns/c1/new-route',
])('그 외 %s는 기존 사용자 조회를 유지한다', async (path) => {
  await updateSession(new NextRequest(`https://app.workdeck.work${path}`))
  expect(auth.getUser).toHaveBeenCalledTimes(1)
  expect(auth.getClaims).not.toHaveBeenCalled()
})

test.each([
  { data: null, error: new Error('invalid signature') },
  { data: null, error: new Error('expired token / refresh failed') },
  { data: null, error: null },
  { data: { claims: {} }, error: null },
  { data: { claims: { sub: 'user' } }, error: new Error('verification failed') },
])('검증 실패·만료·세션 없음은 로그인으로 이동한다', async (result) => {
  auth.getClaims.mockResolvedValue(result)
  const response = await proxy(new NextRequest('https://app.workdeck.work/d/coupang-ads'))
  expect(response.status).toBe(307)
  expect(new URL(response.headers.get('location')!).pathname).toBe('/d/coupang-ads/login')
})

test('토큰 갱신은 downstream 요청 헤더와 브라우저 응답에 같은 쿠키를 전달한다', async () => {
  auth.getClaims.mockImplementation(async () => {
    cookieBridge.setAll([{ name: 'session', value: 'new', options: { path: '/' } }])
    return { data: { claims: { sub: 'user' } }, error: null }
  })
  const request = new NextRequest('https://app.workdeck.work/d/coupang-ads', {
    headers: { cookie: 'session=old' },
  })
  const response = await proxy(request)
  expect(request.cookies.get('session')?.value).toBe('new')
  expect(response.headers.get('x-middleware-request-cookie')).toContain('session=new')
  expect(response.cookies.get('session')?.value).toBe('new')
})

test('갱신 실패의 쿠키 삭제는 로그인 redirect에도 유지되고 로그인에서 되돌아가지 않는다', async () => {
  auth.getClaims.mockImplementation(async () => {
    cookieBridge.setAll([{ name: 'session', value: '', options: { path: '/', maxAge: 0 } }])
    return { data: null, error: new Error('refresh failed') }
  })
  const response = await proxy(new NextRequest('https://app.workdeck.work/d/coupang-ads'))
  expect(response.status).toBe(307)
  expect(response.cookies.get('session')).toMatchObject({ value: '', maxAge: 0 })
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
  const login = await proxy(new NextRequest(response.headers.get('location')!))
  expect(login.status).toBe(200)
  expect(login.headers.get('location')).toBeNull()
})

test('서명 검증이 성공해도 폐기된 세션은 서버 사용자 검사에서 차단하고 광고를 조회하지 않는다', async () => {
  jest.mocked(getUser).mockResolvedValue(null)
  expect((await proxy(new NextRequest('https://app.workdeck.work/d/coupang-ads'))).status).toBe(200)
  await expect(HomePage()).rejects.toThrow('redirect:/login')
  expect((await resolveWorkspace()).error?.status).toBe(401)
  expect(getUser).toHaveBeenCalled()
  expect(queryKpi).not.toHaveBeenCalled()
  expect(queryCampaigns).not.toHaveBeenCalled()
})

test('admin 루트 rewrite에도 갱신된 요청 쿠키와 응답 쿠키를 전달한다', async () => {
  auth.getUser.mockImplementation(async () => {
    cookieBridge.setAll([{ name: 'session', value: 'new', options: { path: '/' } }])
    return { data: { user: { id: 'user' } }, error: null }
  })
  const response = await proxy(
    new NextRequest('https://admin.workdeck.work/', {
      headers: { host: 'admin.workdeck.work', cookie: 'session=old' },
    })
  )
  expect(new URL(response.headers.get('x-middleware-rewrite')!).pathname).toBe('/admin')
  expect(response.headers.get('x-middleware-request-cookie')).toContain('session=new')
  expect(response.cookies.get('session')?.value).toBe('new')
})

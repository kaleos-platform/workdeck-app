/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/spaces/current-space', () => ({
  CURRENT_SPACE_COOKIE: 'wd_space',
  CURRENT_SPACE_COOKIE_OPTIONS: {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 1,
  },
  listMemberships: jest.fn(),
  resolveCurrentMembership: jest.fn(),
}))
import { NextRequest } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { listMemberships, resolveCurrentMembership } from '@/lib/spaces/current-space'
import { GET, POST } from '../route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://x/api/spaces/current', { method: 'POST', body: JSON.stringify(body) })
  )
beforeEach(() => {
  jest.resetAllMocks()
  ;(getUser as jest.Mock).mockResolvedValue({ id: 'u' })
  ;(listMemberships as jest.Mock).mockResolvedValue([
    { role: 'OWNER', createdAt: new Date(), space: { id: 'sp-a', name: 'Space A' } },
    { role: 'MEMBER', createdAt: new Date(), space: { id: 'sp-b', name: 'Space B' } },
  ])
})

it('GET 은 현재 Space 와 목록', async () => {
  ;(resolveCurrentMembership as jest.Mock).mockResolvedValue({
    role: 'OWNER',
    space: { id: 'sp-a', name: 'Space A' },
  })
  const body = await (await GET()).json()
  expect(body).toEqual({
    current: { id: 'sp-a', name: 'Space A', role: 'OWNER' },
    spaces: [
      { id: 'sp-a', name: 'Space A', role: 'OWNER' },
      { id: 'sp-b', name: 'Space B', role: 'MEMBER' },
    ],
  })
})

it('POST 구성원 Space 면 204 + 쿠키', async () => {
  const res = await post({ spaceId: 'sp-b' })
  expect(res.status).toBe(204)
  expect(res.headers.get('set-cookie')).toContain('wd_space=sp-b')
})

it('POST 비구성원 404, 형식 오류 422, 미로그인 401 — 쿠키 없음', async () => {
  expect((await post({ spaceId: 'sp-x' })).status).toBe(404)
  expect((await post({})).status).toBe(422)
  ;(getUser as jest.Mock).mockResolvedValue(null)
  const res = await post({ spaceId: 'sp-a' })
  expect(res.status).toBe(401)
  expect(res.headers.get('set-cookie')).toBeNull()
})

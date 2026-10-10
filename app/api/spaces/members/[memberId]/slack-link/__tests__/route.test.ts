/** @jest-environment node */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveSpaceContext } from '@/lib/api-helpers'
import { PUT } from '../route'

jest.mock('@/lib/api-helpers', () => {
  const { NextResponse } = jest.requireActual('next/server')
  const rank = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const
  return {
    resolveSpaceContext: jest.fn(),
    errorResponse: (message: string, status: number) => NextResponse.json({ message }, { status }),
    assertRole: (r: keyof typeof rank, req: keyof typeof rank) =>
      rank[r] < rank[req]
        ? NextResponse.json({ message: '권한이 없습니다' }, { status: 403 })
        : null,
  }
})
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceMember: { findFirst: jest.fn(), update: jest.fn() } },
}))

const ctx = resolveSpaceContext as jest.Mock
const m = prisma.spaceMember as unknown as { findFirst: jest.Mock; update: jest.Mock }
const req = (body: unknown) =>
  new NextRequest('http://t/api/spaces/members/m1/slack-link', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
const params = { params: Promise.resolve({ memberId: 'm1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  ctx.mockResolvedValue({ user: { id: 'u' }, space: { id: 's1' }, role: 'ADMIN' })
})

test('MEMBER 는 연결할 수 없다 → 403', async () => {
  ctx.mockResolvedValue({ user: { id: 'u' }, space: { id: 's1' }, role: 'MEMBER' })
  expect((await PUT(req({ slackUserId: 'U12345' }), params)).status).toBe(403)
})

test('다른 Space 구성원 → 404', async () => {
  m.findFirst.mockResolvedValue(null)
  expect((await PUT(req({ slackUserId: 'U12345' }), params)).status).toBe(404)
  expect(m.findFirst.mock.calls[0][0].where).toEqual({ id: 'm1', spaceId: 's1' })
})

test('형식이 틀린 Slack ID → 400', async () => {
  expect((await PUT(req({ slackUserId: 'slack:U1' }), params)).status).toBe(400)
})

test('ADMIN 이 OWNER 구성원의 Slack 연결을 바꾸려 하면 403, 갱신 없음(승인 우회 차단)', async () => {
  m.findFirst.mockResolvedValue({ id: 'm1', role: 'OWNER', userId: 'u-owner' })
  expect((await PUT(req({ slackUserId: 'UADMIN1' }), params)).status).toBe(403)
  expect((await PUT(req({ slackUserId: null }), params)).status).toBe(403)
  expect(m.update).not.toHaveBeenCalled()
})

test('다른 OWNER 도 OWNER 구성원의 연결을 바꾸거나 해제할 수 없다 → 403, 갱신 없음', async () => {
  ctx.mockResolvedValue({ user: { id: 'u-owner2' }, space: { id: 's1' }, role: 'OWNER' })
  m.findFirst.mockResolvedValue({ id: 'm1', role: 'OWNER', userId: 'u-owner' })
  expect((await PUT(req({ slackUserId: 'UOWNER2' }), params)).status).toBe(403)
  expect((await PUT(req({ slackUserId: null }), params)).status).toBe(403)
  expect(m.update).not.toHaveBeenCalled()
})

test('OWNER 본인은 자기 연결을 바꿀 수 있다', async () => {
  ctx.mockResolvedValue({ user: { id: 'u-owner' }, space: { id: 's1' }, role: 'OWNER' })
  m.findFirst.mockResolvedValue({ id: 'm1', role: 'OWNER', userId: 'u-owner' })
  m.update.mockResolvedValue({ id: 'm1', slackUserId: 'UOWNER1' })
  expect((await PUT(req({ slackUserId: 'UOWNER1' }), params)).status).toBe(200)
})

test('이미 다른 구성원에 연결된 Slack ID → 409', async () => {
  m.findFirst.mockResolvedValue({ id: 'm1', role: 'MEMBER' })
  m.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
  expect((await PUT(req({ slackUserId: 'U12345' }), params)).status).toBe(409)
})

test('ADMIN 은 OWNER 가 아닌 구성원의 연결·해제를 할 수 있다', async () => {
  m.findFirst.mockResolvedValue({ id: 'm1', role: 'ADMIN' })
  m.update.mockResolvedValue({ id: 'm1', slackUserId: null })
  expect((await PUT(req({ slackUserId: null }), params)).status).toBe(200)
})

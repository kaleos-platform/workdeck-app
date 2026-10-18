/** @jest-environment node */
jest.mock('@/lib/admin/auth', () => ({
  requireOperator: jest.fn(),
  writeAuditLog: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    space: { findUnique: jest.fn(), updateMany: jest.fn() },
    spaceMember: { findUnique: jest.fn(), create: jest.fn() },
  },
}))

import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const m = prisma as unknown as {
  user: { findUnique: jest.Mock }
  space: { findUnique: jest.Mock; updateMany: jest.Mock }
  spaceMember: { findUnique: jest.Mock; create: jest.Mock }
}
const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'u-2', spaceId: 'sp-1' }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op-1' } })
  m.user.findUnique.mockResolvedValue({ id: 'u-2' })
  m.space.findUnique.mockResolvedValue({ id: 'sp-1', type: 'ORGANIZATION' })
  m.spaceMember.findUnique.mockResolvedValue(null)
  m.spaceMember.create.mockResolvedValue({
    id: 'mem-1',
    spaceId: 'sp-1',
    userId: 'u-2',
    role: 'ADMIN',
  })
})

it('운영자가 아니면 그 응답을 그대로 돌려준다', async () => {
  const denied = new Response(null, { status: 403 })
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: false, response: denied })
  expect((await call({ role: 'ADMIN' })).status).toBe(403)
  expect(m.spaceMember.create).not.toHaveBeenCalled()
})

it('ADMIN으로 추가하고 감사 로그를 남긴다', async () => {
  const res = await call({ role: 'ADMIN' })
  expect(res.status).toBe(201)
  expect(m.spaceMember.create).toHaveBeenCalledWith({
    data: { spaceId: 'sp-1', userId: 'u-2', role: 'ADMIN' },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'op-1',
    'user.membership.add',
    'space_member',
    'mem-1',
    {
      userId: 'u-2',
      spaceId: 'sp-1',
      role: 'ADMIN',
    }
  )
})

it('OWNER나 잘못된 본문은 422', async () => {
  expect((await call({ role: 'OWNER' })).status).toBe(422)
  expect((await call({})).status).toBe(422)
})

it('사용자나 Space가 없으면 404', async () => {
  m.user.findUnique.mockResolvedValueOnce(null)
  expect((await call({ role: 'ADMIN' })).status).toBe(404)
  m.space.findUnique.mockResolvedValueOnce(null)
  expect((await call({ role: 'ADMIN' })).status).toBe(404)
})

it('개인 Space에 추가하면 팀 Space로 전환하고 감사 로그를 남긴다', async () => {
  m.space.findUnique.mockResolvedValue({ id: 'sp-1', type: 'PERSONAL' })
  m.space.updateMany.mockResolvedValue({ count: 1 })
  expect((await call({ role: 'MEMBER' })).status).toBe(201)
  expect(m.space.updateMany).toHaveBeenCalledWith({
    where: { id: 'sp-1', type: 'PERSONAL' },
    data: { type: 'ORGANIZATION' },
  })
  expect(writeAuditLog).toHaveBeenCalledWith('op-1', 'space.type.convert', 'space', 'sp-1', {
    from: 'PERSONAL',
    to: 'ORGANIZATION',
    via: 'admin.membership.add',
  })
})

it('팀 Space는 전환하지 않는다', async () => {
  expect((await call({ role: 'MEMBER' })).status).toBe(201)
  expect(m.space.updateMany).not.toHaveBeenCalled()
})

it('이미 구성원이면 409(역할은 PATCH로 바꾼다)', async () => {
  m.spaceMember.findUnique.mockResolvedValue({ id: 'mem-0', role: 'MEMBER' })
  expect((await call({ role: 'ADMIN' })).status).toBe(409)
  expect(m.spaceMember.create).not.toHaveBeenCalled()
})

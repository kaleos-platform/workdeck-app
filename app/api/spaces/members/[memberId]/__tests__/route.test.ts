/** @jest-environment node */
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceOwner: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceMember: { findUnique: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() } },
}))

import { NextResponse } from 'next/server'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { PATCH, DELETE } from '../route'

const m = prisma.spaceMember as unknown as Record<
  'findUnique' | 'updateMany' | 'deleteMany',
  jest.Mock
>
const ctx = (memberId = 'm-2') => ({ params: Promise.resolve({ memberId }) })
const patch = (body: unknown, id?: string) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), ctx(id))
const del = (id?: string) => DELETE(new Request('http://x', { method: 'DELETE' }), ctx(id))

beforeEach(() => {
  jest.clearAllMocks()
  m.findUnique.mockResolvedValue({ id: 'm-2', spaceId: 'sp-1', userId: 'u-2', role: 'ADMIN' })
  m.updateMany.mockResolvedValue({ count: 1 })
  m.deleteMany.mockResolvedValue({ count: 1 })
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({ userId: 'u-owner' })
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
})

test('OWNER 가 역할을 바꾸면 갱신하고 감사 로그를 남긴다', async () => {
  const res = await patch({ role: 'MEMBER' })
  expect(res.status).toBe(200)
  expect(requireSpaceOwner).toHaveBeenCalledWith('sp-1')
  expect(m.updateMany).toHaveBeenCalledWith({
    where: { id: 'm-2', spaceId: 'sp-1', role: { not: 'OWNER' } },
    data: { role: 'MEMBER' },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.member.role_change',
    'space_member',
    'm-2',
    { spaceId: 'sp-1', userId: 'u-2', fromRole: 'ADMIN', toRole: 'MEMBER' }
  )
})

test('OWNER 가 내보내면 삭제하고 감사 로그를 남긴다', async () => {
  const res = await del()
  expect(res.status).toBe(200)
  expect(m.deleteMany).toHaveBeenCalledWith({
    where: { id: 'm-2', spaceId: 'sp-1', role: { not: 'OWNER' } },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'u-owner',
    'space.member.remove',
    'space_member',
    'm-2',
    {
      spaceId: 'sp-1',
      userId: 'u-2',
      role: 'ADMIN',
    }
  )
})

test('없는 구성원 404', async () => {
  m.findUnique.mockResolvedValue(null)
  expect((await patch({ role: 'MEMBER' })).status).toBe(404)
  expect((await del()).status).toBe(404)
})

test('그 Space 의 OWNER 가 아니면 404(존재 숨김), 미로그인은 401 그대로', async () => {
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({
    error: NextResponse.json({ message: '권한이 없습니다' }, { status: 403 }),
  })
  expect((await patch({ role: 'MEMBER' })).status).toBe(404)
  ;(requireSpaceOwner as jest.Mock).mockResolvedValue({
    error: NextResponse.json({ message: '인증이 필요합니다' }, { status: 401 }),
  })
  expect((await del()).status).toBe(401)
  expect(m.updateMany).not.toHaveBeenCalled()
  expect(m.deleteMany).not.toHaveBeenCalled()
})

test('MFA(aal2) 아니면 그 응답을 돌려주고 바꾸지 않는다', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ message: '2단계 인증이 필요합니다', code: 'MFA_REQUIRED' }, { status: 403 })
  )
  expect((await patch({ role: 'MEMBER' })).status).toBe(403)
  expect((await del()).status).toBe(403)
  expect(m.updateMany).not.toHaveBeenCalled()
  expect(m.deleteMany).not.toHaveBeenCalled()
})

test('OWNER 구성원과 본인은 대상이 아니다(400)', async () => {
  m.findUnique.mockResolvedValue({ id: 'm-1', spaceId: 'sp-1', userId: 'u-x', role: 'OWNER' })
  expect((await patch({ role: 'ADMIN' }, 'm-1')).status).toBe(400)
  m.findUnique.mockResolvedValue({ id: 'm-3', spaceId: 'sp-1', userId: 'u-owner', role: 'ADMIN' })
  expect((await del('m-3')).status).toBe(400)
  expect(m.updateMany).not.toHaveBeenCalled()
  expect(m.deleteMany).not.toHaveBeenCalled()
})

test('역할 값이 OWNER 이거나 잘못되면 422', async () => {
  expect((await patch({ role: 'OWNER' })).status).toBe(422)
  expect((await patch({})).status).toBe(422)
  expect(m.updateMany).not.toHaveBeenCalled()
})

test('OWNER·본인 거부는 PATCH·DELETE 모두', async () => {
  m.findUnique.mockResolvedValue({ id: 'm-1', spaceId: 'sp-1', userId: 'u-x', role: 'OWNER' })
  expect((await del('m-1')).status).toBe(400)
  m.findUnique.mockResolvedValue({ id: 'm-3', spaceId: 'sp-1', userId: 'u-owner', role: 'ADMIN' })
  expect((await patch({ role: 'MEMBER' }, 'm-3')).status).toBe(400)
})

test('확인 뒤 OWNER 로 바뀌었거나 지워졌으면 404 이고 감사 로그를 남기지 않는다', async () => {
  m.updateMany.mockResolvedValue({ count: 0 })
  m.deleteMany.mockResolvedValue({ count: 0 })
  expect((await patch({ role: 'MEMBER' })).status).toBe(404)
  expect((await del()).status).toBe(404)
  expect(writeAuditLog).not.toHaveBeenCalled()
})

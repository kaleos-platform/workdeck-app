/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: { spaceMember: { findUnique: jest.fn() } } }))

import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { requireSpaceAdmin, requireSpaceOwner } from '../space-admin'

const user = getUser as jest.Mock
const findMember = (prisma as unknown as { spaceMember: { findUnique: jest.Mock } }).spaceMember
  .findUnique

describe('requireSpaceAdmin', () => {
  beforeEach(() => jest.clearAllMocks())

  it('비로그인은 401', async () => {
    user.mockResolvedValue(null)
    const r = await requireSpaceAdmin('sp1')
    expect('error' in r && r.error.status).toBe(401)
  })

  it.each([
    ['MEMBER', 403],
    [null, 403],
  ])('role=%p 이면 %p', async (role, status) => {
    user.mockResolvedValue({ id: 'u1' })
    findMember.mockResolvedValue(role ? { role } : null)
    const r = await requireSpaceAdmin('sp1')
    expect('error' in r && r.error.status).toBe(status)
  })

  it.each(['OWNER', 'ADMIN'])('%s 는 통과하고 경로 spaceId로 멤버십을 조회한다', async (role) => {
    user.mockResolvedValue({ id: 'u1' })
    findMember.mockResolvedValue({ role })
    await expect(requireSpaceAdmin('sp2')).resolves.toEqual({ userId: 'u1' })
    expect(findMember.mock.calls[0][0].where).toEqual({
      spaceId_userId: { spaceId: 'sp2', userId: 'u1' },
    })
  })
})

describe('requireSpaceOwner', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    ['ADMIN', 403],
    ['MEMBER', 403],
  ])('role=%p 이면 %p', async (role, status) => {
    user.mockResolvedValue({ id: 'u1' })
    findMember.mockResolvedValue({ role })
    const r = await requireSpaceOwner('sp1')
    expect('error' in r && r.error.status).toBe(status)
  })

  it('OWNER는 통과한다', async () => {
    user.mockResolvedValue({ id: 'u1' })
    findMember.mockResolvedValue({ role: 'OWNER' })
    await expect(requireSpaceOwner('sp1')).resolves.toEqual({ userId: 'u1' })
  })
})

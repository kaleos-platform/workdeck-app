/** @jest-environment node */
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveRequestedSpaceContext: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceMember: { findMany: jest.fn() }, space: { findUnique: jest.fn() } },
}))

import { NextRequest } from 'next/server'
import { resolveRequestedSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const resolve = resolveRequestedSpaceContext as jest.Mock
const p = prisma as unknown as {
  spaceMember: { findMany: jest.Mock }
  space: { findUnique: jest.Mock }
}

it('쓰기 대상 spaceId 와 같은 Space 의 이름(spaceName)을 함께 준다', async () => {
  resolve.mockResolvedValue({
    user: { id: 'u' },
    space: { id: 'sp-1', name: 'Space A' },
    role: 'OWNER',
  })
  p.spaceMember.findMany.mockResolvedValue([])
  p.space.findUnique.mockResolvedValue({ approvalLimitKrw: 1000 })
  const res = await GET(new NextRequest('http://x/api/spaces/members'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    spaceId: 'sp-1',
    spaceName: 'Space A',
    myRole: 'OWNER',
    members: [],
    approvalLimitKrw: 1000,
  })
})

/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PATCH as updateBasic } from '../../route'
import { POST as addPosition } from '../../positions/route'
import {
  PATCH as updatePosition,
  DELETE as deletePosition,
} from '../../positions/[positionId]/route'
import { PUT as updateStores } from '../../stores/route'
import { prisma } from '@/lib/prisma'
jest.mock('@/lib/prisma', () => ({ prisma: { hiringPosting: { findFirst: jest.fn() } } }))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 's' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
it.each([updateBasic, addPosition, updatePosition, deletePosition, updateStores])(
  '발행된 공고의 모집 조건 변경을 저장 전에 거부한다',
  async (handler) => {
    jest
      .mocked(prisma.hiringPosting.findFirst)
      .mockResolvedValue({ id: 'p', status: 'DRAFT', publishedAt: new Date('2023-01-01') } as never)
    const response = await handler(
      new NextRequest('http://localhost/api', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ id: 'p', positionId: 'j' }) }
    )
    expect(response?.status).toBe(409)
  }
)

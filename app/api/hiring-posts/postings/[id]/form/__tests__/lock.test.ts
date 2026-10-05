/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PUT } from '../route'
import { prisma } from '@/lib/prisma'
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findFirst: jest.fn(), update: jest.fn() } },
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 's' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
it.each(['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'])(
  '%s라도 최초 발행 이력이 있으면 지원서 수정을 차단한다',
  async (status) => {
    jest
      .mocked(prisma.hiringPosting.findFirst)
      .mockResolvedValue({ id: 'p', status, publishedAt: new Date('2023-01-01') } as never)
    const response = await PUT(
      new NextRequest('http://localhost/form', { method: 'PUT', body: '{}' }),
      { params: Promise.resolve({ id: 'p' }) }
    )
    expect(response?.status).toBe(409)
    expect(prisma.hiringPosting.update).not.toHaveBeenCalled()
  }
)

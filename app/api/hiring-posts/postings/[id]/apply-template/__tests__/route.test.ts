/** @jest-environment node */
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringPosting: { findFirst: jest.fn().mockResolvedValue({ id: 'qa' }) },
    hiringDetailTemplate: {
      findFirst: jest.fn().mockResolvedValue({ id: 't', name: 'QA', contents: [] }),
    },
    hiringContent: { findMany: jest.fn().mockRejectedValue(new Error('트랜잭션 밖 조회 실패')) },
    $transaction: jest.fn(),
  },
}))
it('템플릿 변경과 반환용 조회를 같은 트랜잭션 안에서 처리한다', async () => {
  const tx = {
    hiringContent: { deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    hiringPosting: { update: jest.fn() },
  }
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (work: unknown) => (work as (arg: typeof tx) => unknown)(tx))
  const req = {
    json: async () => ({ templateId: 'cmuhr69ry00000kjvnadsqti1', mode: 'replace' }),
  } as NextRequest
  const res = await POST(req, { params: Promise.resolve({ id: 'qa' }) })
  expect(res?.status).toBe(200)
  expect(await res?.json()).toEqual({ contents: [] })
  expect(tx.hiringContent.findMany).toHaveBeenCalledTimes(1)
  expect(prisma.hiringContent.findMany).not.toHaveBeenCalled()
})

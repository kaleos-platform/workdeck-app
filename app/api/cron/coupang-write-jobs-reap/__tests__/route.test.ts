/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/cron/with-cron-run', () => ({
  withCronRun: (_path: string, handler: (r: unknown) => Promise<Record<string, unknown>>) => handler,
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { coupangWriteJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } },
}))
const updateMany = prisma.coupangWriteJob.updateMany as unknown as jest.Mock

test('한 번도 집히지 않은 PENDING 가격 잡은 15분 뒤 FAILED 로 만료한다', async () => {
  const now = Date.now()
  await GET(new NextRequest('http://localhost/x'))
  const expire = updateMany.mock.calls.find((c) => c[0].where.status === 'PENDING')
  expect(expire).toBeDefined()
  const { where, data } = expire![0]
  expect(where).toEqual({
    kind: 'PRICE_CHANGE',
    status: 'PENDING',
    attempts: 0,
    createdAt: { lt: expect.any(Date) },
  })
  expect(Math.abs(now - 15 * 60 * 1000 - where.createdAt.lt.getTime())).toBeLessThan(5_000)
  expect(data).toEqual({ status: 'FAILED', error: '워커가 처리하지 않아 만료됐습니다', executedAt: expect.any(Date) })
})

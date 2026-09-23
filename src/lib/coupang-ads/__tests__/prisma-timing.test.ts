/** @jest-environment node */

const queryListeners: Array<(event: { duration: number; query: string; params: string }) => void> =
  []
const client = {
  $on: jest.fn((_event, listener) => queryListeners.push(listener)),
  $queryRaw: jest.fn(async () => {
    for (const listener of queryListeners) {
      listener({ duration: 12.5, query: 'private-sql', params: 'private-values' })
    }
    return [{ ok: true }]
  }),
}
jest.mock('@/generated/prisma/client', () => ({ PrismaClient: jest.fn(() => client) }))
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }))

import { prisma } from '@/lib/prisma'
import { withCoupangAdsTiming } from '../server-timing'

beforeEach(() => {
  delete (globalThis as { _prisma?: unknown })._prisma
  queryListeners.length = 0
  jest.clearAllMocks()
})

test('최초 client 생성과 query 이벤트 시간을 분리하고 SQL·파라미터는 기록하지 않는다', async () => {
  const original = process.env.DATABASE_URL
  const direct = process.env.DIRECT_URL
  process.env.DATABASE_URL = 'postgresql://localhost/test'
  delete process.env.DIRECT_URL
  try {
    const first = await withCoupangAdsTiming(async () => {
      expect(await prisma.$queryRaw`SELECT 1`).toEqual([{ ok: true }])
      return new Response()
    })
    expect(first.headers.get('server-timing')).toContain('prisma_client;dur=')
    expect(first.headers.get('server-timing')).toContain('db_query;dur=12.5')
    expect(first.headers.get('server-timing')).not.toContain('private')
    const second = await withCoupangAdsTiming(async () => {
      await prisma.$queryRaw`SELECT 1`
      return new Response()
    })
    expect(second.headers.get('server-timing')).not.toContain('prisma_client;')
    expect(second.headers.get('server-timing')).toContain('db_query;dur=12.5')
    expect(client.$on).toHaveBeenCalledTimes(1)
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
    if (direct === undefined) delete process.env.DIRECT_URL
    else process.env.DIRECT_URL = direct
    delete (globalThis as { _prisma?: unknown })._prisma
  }
})

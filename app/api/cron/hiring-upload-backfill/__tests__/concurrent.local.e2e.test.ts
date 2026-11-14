/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
const localTest = process.env.WORKDECK_BACKFILL_LOCAL_TEST === '1' ? it : it.skip

localTest('겹친 두 실행은 각 세션을 중복 처리하지 않는다', async () => {
  const results = await Promise.all([GET(new NextRequest('http://localhost/backfill')), GET(new NextRequest('http://localhost/backfill'))]) as unknown as Array<{ status: string; scanned: number }>
  expect(results.every((result) => result.status === 'ok')).toBe(true)
  expect(results.reduce((sum, result) => sum + result.scanned, 0)).toBe(60)
  const rows = await prisma.$queryRaw<Array<{ count: number; distinct: number }>>`
    SELECT count(*)::int AS count, count(DISTINCT id)::int AS distinct FROM audit_test
  `
  expect(rows[0]).toEqual({ count: 60, distinct: 60 })
  await prisma.$disconnect()
})

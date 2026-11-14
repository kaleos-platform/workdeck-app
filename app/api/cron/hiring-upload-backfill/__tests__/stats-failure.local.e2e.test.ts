/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
const localTest = process.env.WORKDECK_BACKFILL_LOCAL_TEST === '1' ? it : it.skip

localTest('통계 실패에도 확정된 처리 건수를 유지하고 잔여 상태는 미확인이다', async () => {
  const result = await GET(new NextRequest('http://localhost/backfill'))
  expect(result).toMatchObject({ status: 'unavailable', completion: 'unknown', scanned: 1, remaining: null })
  const rows = await prisma.$queryRaw<Array<{ done: boolean }>>`
    SELECT "cleanupBackfilledAt" IS NOT NULL AS done FROM "HiringUploadSession"
    WHERE id = '00000000-0000-4000-8000-000000000001'
  `
  expect(rows[0].done).toBe(true)
  await prisma.$disconnect()
})

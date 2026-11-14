/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
const localTest = process.env.WORKDECK_BACKFILL_LOCAL_TEST === '1' ? it : it.skip

localTest('50건을 넘는 영구 실패 뒤에도 정상 세션이 처리된다', async () => {
  for (let i = 0; i < 3; i++) {
    const result = await GET(new NextRequest('http://localhost/backfill'))
    expect(JSON.stringify(result)).not.toContain('private@example.test')
  }
  const rows = await prisma.$queryRaw<Array<{ done: boolean }>>`
    SELECT "cleanupBackfilledAt" IS NOT NULL AS done FROM "HiringUploadSession"
    WHERE id = '00000000-0000-4000-8000-000000000001'
  `
  expect(rows[0].done).toBe(true)
  await prisma.$disconnect()
})

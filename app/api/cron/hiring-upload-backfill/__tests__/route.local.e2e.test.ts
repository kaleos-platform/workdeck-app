/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))

const localTest = process.env.WORKDECK_BACKFILL_LOCAL_TEST === '1' ? it : it.skip

localTest('별도 service role로 기존 세션을 처리하고 잔여 건수를 반환한다', async () => {
  await prisma.$queryRaw`SELECT 1`
  const result = await GET(new NextRequest('http://localhost/backfill'))
  expect(result).toMatchObject({ status: 'ok', scanned: 1, remaining: process.env.WORKDECK_LOCKED_TEST === '1' ? 1 : 0 })
  await prisma.$disconnect()
})

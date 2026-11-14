/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }))

it('DB 함수의 숫자 집계만 사용하고 원본 식별자를 SQL 매개변수에 전달하지 않는다', async () => {
  const parameters: unknown[] = []
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn((_parts: unknown, ...values: unknown[]) => {
      parameters.push(...values)
      return [{ scanned: 1, failed: 0, remaining: 0, deferred: 0, unverified: 0, quarantined: 0, deadline_reached: false }]
    }),
  }))
  const result = await GET(new NextRequest('http://localhost/backfill'))
  expect(result).toMatchObject({ status: 'ok', completion: 'complete', scanned: 1 })
  expect(parameters.every((value) => typeof value === 'number')).toBe(true)
})

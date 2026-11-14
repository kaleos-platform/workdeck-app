/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn(), $queryRaw: jest.fn() } }))

beforeEach(() => {
  jest.resetAllMocks()
  ;(prisma.$transaction as jest.Mock).mockResolvedValue([{ scanned: 2, failed: 0, remaining: 3, deferred: 0, unverified: 1, quarantined: 2, deadline_reached: false }])
})

it('남은 건수 집계 오류도 0이 아닌 미확인으로 표시한다', async () => {
  ;(prisma.$transaction as jest.Mock).mockReset()
    .mockResolvedValueOnce([{ scanned: 1, failed: 0, deadline_reached: false }])
    .mockRejectedValueOnce(new Error('private path'))
  expect(await GET(new NextRequest('http://localhost/backfill'))).toMatchObject({ status: 'unavailable', scanned: 1, remaining: null })
})

it('처리 건수와 남은 건수를 별도 backfill 상태로 보고한다', async () => {
  expect(await GET(new NextRequest('http://localhost/backfill'))).toMatchObject({ scanned: 2, remaining: 3, unverified: 1, quarantined: 2, status: 'ok' })
})

it('잠금 또는 집계 실패는 원문 없이 미확인으로 보고한다', async () => {
  ;(prisma.$transaction as jest.Mock).mockReset().mockRejectedValue(new Error('secret@example.test'))
  const result = await GET(new NextRequest('http://localhost/backfill'))
  expect(result).toMatchObject({ status: 'unavailable', remaining: null })
  expect(JSON.stringify(result)).not.toContain('secret@example.test')
})

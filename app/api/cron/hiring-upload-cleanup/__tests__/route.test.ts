/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { removeCleanupFiles } from '@/lib/hiring/cleanup-storage'
jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
jest.mock('@/lib/hiring/cleanup-storage', () => ({ removeCleanupFiles: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }))

beforeEach(() => jest.resetAllMocks())
it('참조가 있는 건은 Storage를 지우지 않는다', async () => {
  ;(prisma.$transaction as jest.Mock).mockResolvedValueOnce([{ outcome: 'referenced', token: null, paths: [] }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ due: 0, lag_seconds: 0, quarantined_total: 0, failed_total: 0 }])
  const result = await GET(new NextRequest('http://localhost/cleanup'))
  expect(result).toMatchObject({ referenced: 1, deleteCallsSucceeded: 0 })
  expect(removeCleanupFiles).not.toHaveBeenCalled()
})
it('DB 선확정 실패 시 Storage를 지우지 않고 오류 원문도 반환하지 않는다', async () => {
  ;(prisma.$transaction as jest.Mock).mockRejectedValue(new Error('private@example.test'))
  const result = await GET(new NextRequest('http://localhost/cleanup'))
  expect(result).toMatchObject({ status: 'unavailable' })
  expect(removeCleanupFiles).not.toHaveBeenCalled()
  expect(JSON.stringify(result)).not.toContain('private@example.test')
})
it('검증 불가 건은 격리 수로만 기록하고 다음 건을 계속 처리한다', async () => {
  ;(prisma.$transaction as jest.Mock).mockResolvedValueOnce([{ outcome: 'quarantined', token: null, paths: [] }]).mockResolvedValueOnce([{ outcome: 'referenced', token: null, paths: [] }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ due: 0, lag_seconds: 0, quarantined_total: 1, failed_total: 0 }])
  expect(await GET(new NextRequest('http://localhost/cleanup'))).toMatchObject({ quarantined: 1, referenced: 1, status: 'ok' })
  expect(removeCleanupFiles).not.toHaveBeenCalled()
})
it('Storage 오류는 고정 상태로 보고하고 lease 종료를 요청한다', async () => {
  ;(prisma.$transaction as jest.Mock).mockResolvedValueOnce([{ outcome: 'retired', token: 'synthetic-token', paths: ['synthetic-path'] }]).mockResolvedValueOnce([{ finished: true }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ due: 0, lag_seconds: 0, quarantined_total: 0, failed_total: 1 }])
  ;(removeCleanupFiles as jest.Mock).mockRejectedValue(new Error('private@example.test'))
  const result = await GET(new NextRequest('http://localhost/cleanup'))
  expect(result).toMatchObject({ status: 'partial', failed: 1, deleteCallsSucceeded: 0 })
  expect(JSON.stringify(result)).not.toContain('private@example.test')
  expect(prisma.$transaction).toHaveBeenCalledTimes(4)
})
it('통계 실패는 0 대신 미확인으로 표시한다', async () => {
  ;(prisma.$transaction as jest.Mock).mockResolvedValueOnce([]).mockRejectedValueOnce(Error('private@example.test'))
  expect(await GET(new NextRequest('http://localhost/cleanup'))).toMatchObject({ status: 'unavailable', due: null })
})

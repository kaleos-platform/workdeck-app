/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { getWekeepInventoryRows } from '@/lib/inv/reconciliation-sources'
import { runReconciliationMatch } from '@/lib/inv/reconciliation-core'
import { confirmReconciliation } from '@/lib/inv/reconciliation-processor'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { WekeepError } from '@/lib/inv/wekeep-client'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStorageLocation: { findMany: jest.fn() },
    invReconciliation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cronRun: { create: jest.fn() },
  },
}))
jest.mock('@/lib/inv/reconciliation-sources', () => ({
  getWekeepInventoryRows: jest.fn(),
  WekeepSourceError: class extends Error {},
}))
jest.mock('@/lib/inv/reconciliation-core', () => ({ runReconciliationMatch: jest.fn() }))
jest.mock('@/lib/inv/reconciliation-processor', () => ({ confirmReconciliation: jest.fn() }))
jest.mock('@/lib/slack/send-notification', () => ({ sendSpaceNotification: jest.fn() }))

const findMany = prisma.invStorageLocation.findMany as unknown as jest.Mock
const updateMany = prisma.invReconciliation.updateMany as unknown as jest.Mock
const getRows = getWekeepInventoryRows as jest.Mock
const runMatch = runReconciliationMatch as jest.Mock
const confirm = confirmReconciliation as jest.Mock
const notify = sendSpaceNotification as jest.Mock

const call = (auth = 'Bearer s') =>
  GET(
    new NextRequest('http://x/api/cron/wekeep-weekly-reconcile', {
      headers: auth ? { authorization: auth } : {},
    })
  )

const diff = (optionId: string, system: number, file: number) => ({
  status: 'matched-diff',
  row: { externalCode: optionId, quantity: file },
  optionId,
  locationId: 'L1',
  systemQuantity: system,
  fileQuantity: file,
  delta: file - system,
})
const fileOnly = (quantity: number) => ({
  status: 'file-only',
  row: { externalCode: 'X', quantity },
  locationId: 'L1',
  suggestions: [],
})
const match = (entries: unknown[]) =>
  runMatch.mockResolvedValue({ reconciliationId: 'R1', matchResult: { entries } })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 's'
  findMany.mockResolvedValue([{ id: 'L1', spaceId: 'sp', name: '위킵창고' }])
  getRows.mockResolvedValue({ format: 'inventory_list', rows: [] })
  confirm.mockResolvedValue({ adjustedCount: 2, status: 'CONFIRMED' })
})

test('가드 통과 → 이전 자동 PENDING 취소 + confirm + 반영 알림', async () => {
  match([diff('o1', 10, 12), diff('o2', 5, 4)])
  const body = await (await call()).json()
  expect(updateMany).toHaveBeenCalledWith({
    where: {
      spaceId: 'sp',
      locationId: 'L1',
      status: 'PENDING',
      fileName: { startsWith: '위킵 재고 (자동 ' },
      id: { not: 'R1' },
    },
    data: { status: 'CANCELLED' },
  })
  expect(runMatch.mock.calls[0][0].fileName).toMatch(/^위킵 재고 \(자동 \d{4}-\d{2}-\d{2}\)$/)
  expect(confirm).toHaveBeenCalledWith(
    'sp',
    'R1',
    expect.objectContaining({ selectedOptionIds: ['o1', 'o2'], finalize: true })
  )
  expect(notify.mock.calls[0][0].text).toContain('조정 2건 반영')
  expect(body).toMatchObject({ processed: 1, confirmed: 1, held: 0, failed: 0 })
})

test.each([
  ['차이 51', [diff('o1', 0, 51)]],
  ['차이 옵션 11건', Array.from({ length: 11 }, (_, i) => diff(`o${i}`, 1, 2))],
  ['file-only 수량>0', [diff('o1', 1, 2), fileOnly(3)]],
])('%s → 보류(confirm 미호출) + 보류 알림', async (_n, entries) => {
  match(entries)
  const body = await (await call()).json()
  expect(confirm).not.toHaveBeenCalled()
  expect(notify.mock.calls[0][0].text).toContain('보류')
  expect(notify.mock.calls[0][0].text).toContain('위킵창고')
  expect(body).toMatchObject({ confirmed: 0, held: 1 })
})

test('차이 정확히 50, file-only 수량 0 은 통과', async () => {
  match([diff('o1', 0, 50), fileOnly(0)])
  expect(await (await call()).json()).toMatchObject({ confirmed: 1, held: 0 })
})

test('위킵 실패 → 실패 알림 후 다음 위치 계속 처리', async () => {
  findMany.mockResolvedValue([
    { id: 'L1', spaceId: 'sp', name: 'A' },
    { id: 'L2', spaceId: 'sp', name: 'B' },
  ])
  getRows.mockRejectedValueOnce(new WekeepError('LOGIN_FAILED'))
  match([diff('o1', 1, 2)])
  const body = await (await call()).json()
  expect(notify.mock.calls[0][0].text).toContain('실패')
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(body).toMatchObject({ processed: 2, confirmed: 1, failed: 1 })
})

test('CRON_SECRET bearer 없으면 401', async () => {
  expect((await call('')).status).toBe(401)
  expect(findMany).not.toHaveBeenCalled()
})

test('로그인 실패 시 이전 자동 PENDING 은 취소하지 않는다', async () => {
  getRows.mockRejectedValueOnce(new WekeepError('LOGIN_FAILED'))
  await call()
  expect(updateMany).not.toHaveBeenCalled()
})

test('알 수 없는 오류 → 일반 오류 문구', async () => {
  getRows.mockRejectedValueOnce(new Error('boom'))
  await call()
  expect(notify.mock.calls[0][0].text).toContain('수동 연동')
})

test('confirm 일부 실패 → failed 집계 + 일부 실패 알림', async () => {
  match([diff('o1', 1, 2), diff('o2', 1, 2)])
  confirm.mockResolvedValue({
    adjustedCount: 1,
    status: 'PARTIAL',
    failed: [{ optionId: 'o2', locationId: 'L1', reason: 'x' }],
  })
  const body = await (await call()).json()
  expect(notify.mock.calls[0][0].text).toContain('일부 조정 실패 — 1건 반영, 1건 실패')
  expect(body).toMatchObject({ confirmed: 0, failed: 1 })
})

/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const mockApplyBatchInbound = jest.fn()
const tx = {
  productionRun: { updateMany: jest.fn() },
  productionRunItem: { update: jest.fn() },
  productionRunSet: { update: jest.fn() },
}
const mockPrisma = {
  productionRun: { findFirst: jest.fn() },
  invStorageLocation: { findMany: jest.fn() },
  $transaction: jest.fn(),
}

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 'space-1' } })),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
jest.mock('@/lib/inv/movement-processor', () => ({
  applyBatchInbound: (...a: unknown[]) => mockApplyBatchInbound(...a),
  MovementError: class MovementError extends Error {
    status = 400
  },
}))

// mock 변수 초기화 이후에 로드해야 하므로 require 사용 (import 는 호이스팅됨)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('../route') as typeof import('../route')

const loc = (id: string, type: string, externalSource: string | null = null) => ({
  id,
  name: id,
  type,
  externalSource,
  isActive: true,
})

function setup(locations: ReturnType<typeof loc>[]) {
  mockPrisma.productionRun.findFirst.mockResolvedValue({
    id: 'run-1',
    runNo: 'R1',
    status: 'ORDERED',
    brand: null,
    sets: [],
    items: [
      {
        id: 'item-1',
        optionId: 'opt-1',
        option: {
          id: 'opt-1',
          name: 'o',
          product: { status: 'ACTIVE', name: 'p', internalName: null },
        },
      },
    ],
  })
  mockPrisma.invStorageLocation.findMany.mockResolvedValue(locations)
  mockPrisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx))
  tx.productionRun.updateMany.mockResolvedValue({ count: 1 })
  mockApplyBatchInbound.mockResolvedValue([])
}

const call = (allocations: { optionId: string; locationId: string; quantity: number }[]) =>
  POST(
    new NextRequest('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ status: 'STOCKED_IN', transitionDate: '2026-11-13', allocations }),
    }),
    { params: Promise.resolve({ runId: 'run-1' }) }
  )

beforeEach(() => jest.clearAllMocks())

describe('생산 입고완료 — 외부 물류 위치 분리', () => {
  it('OWN + THIRD_PARTY 혼합: 자체만 INBOUND, 외부는 externalStockIns, stockedInQty 는 합계', async () => {
    setup([loc('office', 'OWN'), loc('wekeep', 'THIRD_PARTY')])
    const res = await call([
      { optionId: 'opt-1', locationId: 'office', quantity: 30 },
      { optionId: 'opt-1', locationId: 'wekeep', quantity: 70 },
    ])
    expect(res?.status).toBe(200)
    const items = mockApplyBatchInbound.mock.calls[0][2]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ locationId: 'office', quantity: 30 })
    expect(tx.productionRun.updateMany.mock.calls[0][0].data.externalStockIns).toEqual([
      { optionId: 'opt-1', locationId: 'wekeep', quantity: 70 },
    ])
    expect(tx.productionRunItem.update.mock.calls[0][0].data.stockedInQty).toBe(100)
  })

  it('전부 외부: applyBatchInbound 미호출', async () => {
    setup([loc('cp', 'OWN', 'coupang_rocket_growth')])
    const res = await call([{ optionId: 'opt-1', locationId: 'cp', quantity: 50 }])
    expect(res?.status).toBe(200)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
    expect(tx.productionRun.updateMany.mock.calls[0][0].data.externalStockIns).toEqual([
      { optionId: 'opt-1', locationId: 'cp', quantity: 50 },
    ])
    expect(tx.productionRunItem.update.mock.calls[0][0].data.stockedInQty).toBe(50)
  })

  it('OWN 만: 기존대로 INBOUND, externalStockIns 비움', async () => {
    setup([loc('office', 'OWN')])
    await call([{ optionId: 'opt-1', locationId: 'office', quantity: 40 }])
    expect(mockApplyBatchInbound.mock.calls[0][2]).toHaveLength(1)
    const data = tx.productionRun.updateMany.mock.calls[0][0].data
    expect(data.externalStockIns).not.toEqual(expect.any(Array))
    expect(data.stockInLocationId).toBe('office')
  })
})

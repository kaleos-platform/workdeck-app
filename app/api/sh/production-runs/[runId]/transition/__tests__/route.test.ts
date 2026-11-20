/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const mockApplyBatchInbound = jest.fn()
const tx = {
  $queryRaw: jest.fn(),
  productionRun: {
    updateMany: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  productionRunItem: { update: jest.fn(), updateMany: jest.fn() },
  productionRunSet: { update: jest.fn(), updateMany: jest.fn() },
  invMovement: { findMany: jest.fn() },
  invReconciliation: { findMany: jest.fn() },
  invStorageLocation: { findMany: jest.fn() },
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
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
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

function setup(locations: ReturnType<typeof loc>[], status = 'ORDERED') {
  mockPrisma.productionRun.findFirst.mockResolvedValue({
    id: 'run-1',
    runNo: 'R1',
    status,
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

type Alloc = { optionId: string; locationId: string; quantity: number }
const call = (allocations: Alloc[], extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({
        status: 'STOCKED_IN',
        transitionDate: '2026-11-13',
        allocations,
        ...extra,
      }),
    }),
    { params: Promise.resolve({ runId: 'run-1' }) }
  )

let registered: unknown[] = []
let adjustments: unknown[] = []

beforeEach(() => {
  jest.clearAllMocks()
  tx.$queryRaw.mockResolvedValue([])
  registered = []
  adjustments = []
  tx.invMovement.findMany.mockImplementation(async (a: { where: { type?: string } }) =>
    a.where.type === 'ADJUSTMENT' ? adjustments : registered
  )
  tx.invReconciliation.findMany.mockResolvedValue([])
  tx.invStorageLocation.findMany.mockResolvedValue([
    { id: 'office', type: 'OWN', externalSource: null },
  ])
})

describe('생산 입고완료 — 재고 입고 분리', () => {
  it('기본(ownStockIn 없음): INBOUND 없음, 모든 분배를 externalStockIns 에 기록, stockedInQty 는 합계', async () => {
    setup([loc('office', 'OWN'), loc('wekeep', 'THIRD_PARTY')])
    const res = await call([
      { optionId: 'opt-1', locationId: 'office', quantity: 30 },
      { optionId: 'opt-1', locationId: 'wekeep', quantity: 70 },
    ])
    expect(res?.status).toBe(200)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
    expect(tx.productionRun.updateMany.mock.calls[0][0].data.externalStockIns).toEqual([
      { optionId: 'opt-1', locationId: 'office', quantity: 30 },
      { optionId: 'opt-1', locationId: 'wekeep', quantity: 70 },
    ])
    expect(tx.productionRunItem.update.mock.calls[0][0].data.stockedInQty).toBe(100)
  })

  it('ownStockIn=true: 자체 위치 분배만 INBOUND (기존 referenceId)', async () => {
    setup([loc('office', 'OWN'), loc('wekeep', 'THIRD_PARTY'), loc('cp', 'OWN', 'coupang')])
    const res = await call(
      [
        { optionId: 'opt-1', locationId: 'office', quantity: 30 },
        { optionId: 'opt-1', locationId: 'wekeep', quantity: 50 },
        { optionId: 'opt-1', locationId: 'cp', quantity: 20 },
      ],
      { ownStockIn: true }
    )
    expect(res?.status).toBe(200)
    const items = mockApplyBatchInbound.mock.calls[0][2]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      locationId: 'office',
      quantity: 30,
      referenceId: 'prodrun:run-1:opt-1:office',
    })
  })

  it('ownStockIn=true 라도 전부 외부면 applyBatchInbound 미호출', async () => {
    setup([loc('cp', 'OWN', 'coupang_rocket_growth')])
    await call([{ optionId: 'opt-1', locationId: 'cp', quantity: 50 }], { ownStockIn: true })
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })

  it('같은 옵션·위치 allocations 중복은 400', async () => {
    setup([loc('office', 'OWN')])
    const res = await call([
      { optionId: 'opt-1', locationId: 'office', quantity: 10 },
      { optionId: 'opt-1', locationId: 'office', quantity: 5 },
    ])
    expect(res?.status).toBe(400)
    expect(tx.productionRun.updateMany).not.toHaveBeenCalled()
  })
})

describe('입고 완료 되돌리기', () => {
  const revert = (status = 'ORDERED') =>
    POST(
      new NextRequest('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify({ status, transitionDate: '2026-11-20' }),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) }
    )
  const stocked = (
    externalStockIns: unknown = [{ optionId: 'opt-1', locationId: 'office', quantity: 5 }]
  ) => {
    setup([loc('office', 'OWN')], 'STOCKED_IN')
    tx.productionRun.findUniqueOrThrow.mockResolvedValue({
      id: 'run-1',
      stockedInAt: new Date('2026-11-13T00:00:00Z'),
      externalStockIns,
    })
  }

  it('등록된 입고·확정 대조가 없으면 허용하고 분배·실입고량을 초기화', async () => {
    stocked()
    const res = await revert()
    expect(res?.status).toBe(200)
    const data = tx.productionRun.update.mock.calls[0][0].data
    expect(data).toMatchObject({ stockedInAt: null, completedAt: null, stockInLocationId: null })
    expect(data.externalStockIns).toBeDefined()
    expect(data.externalStockIns).not.toEqual(expect.any(Array))
    expect(tx.productionRunItem.updateMany.mock.calls[0][0].data).toEqual({ stockedInQty: null })
    expect(tx.productionRunSet.updateMany.mock.calls[0][0].data).toEqual({ stockedInSetQty: null })
  })

  it('PLANNED 로도 되돌릴 수 있다', async () => {
    stocked()
    expect((await revert('PLANNED'))?.status).toBe(200)
  })

  it('그 차수 INBOUND 가 있으면 409', async () => {
    stocked()
    registered = [
      { referenceId: 'prodrun:run-1:opt-1:office', quantity: 5, movementDate: new Date() },
    ]
    const res = await revert()
    expect(res?.status).toBe(409)
    expect(tx.productionRun.update).not.toHaveBeenCalled()
  })

  it('입고 이후 확정 대조가 있으면 409', async () => {
    stocked()
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc1',
        status: 'CONFIRMED',
        locationId: 'office',
        confirmedAt: new Date('2026-11-14T00:00:00Z'),
        createdAt: new Date('2026-11-14T00:00:00Z'),
      },
    ])
    expect((await revert())?.status).toBe(409)
  })

  it('분배 기록이 없는 레거시 차수는 409', async () => {
    stocked(null)
    const res = await revert()
    expect(res?.status).toBe(409)
    expect(tx.productionRun.update).not.toHaveBeenCalled()
  })

  it('상태 선점 실패(동시 변경)는 409', async () => {
    stocked()
    tx.productionRun.updateMany.mockResolvedValue({ count: 0 })
    expect((await revert())?.status).toBe(409)
  })

  it('진행 중(PARTIAL) 대조의 ADJUSTMENT 가 입고 이후 적용됐으면 409', async () => {
    stocked()
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc1',
        status: 'PARTIAL',
        locationId: 'office',
        confirmedAt: null,
        createdAt: new Date('2026-11-13T00:00:00Z'),
      },
    ])
    adjustments = [
      { locationId: 'office', referenceId: 'rc1', createdAt: new Date('2026-11-15T00:00:00Z') },
    ]
    expect((await revert())?.status).toBe(409)
  })

  it('자체 위치는 같은 날(KST) 대조면 막지 않는다', async () => {
    stocked()
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc1',
        status: 'CONFIRMED',
        locationId: 'office',
        confirmedAt: new Date('2026-11-13T05:00:00Z'),
        createdAt: new Date('2026-11-13T05:00:00Z'),
      },
    ])
    expect((await revert())?.status).toBe(200)
  })

  it('분배 위치 행을 잠근 뒤 판정한다(차수 행 → 위치 행)', async () => {
    stocked()
    await revert()
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
  })
})

describe('ownStockIn — 이미 대조된 자체 위치', () => {
  it('전환 일자 이후 KST 날짜의 대조가 있으면 409, INBOUND 없음', async () => {
    setup([loc('office', 'OWN')])
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc1',
        status: 'CONFIRMED',
        locationId: 'office',
        confirmedAt: new Date('2026-11-14T00:00:00Z'),
        createdAt: new Date('2026-11-14T00:00:00Z'),
      },
    ])
    const res = await call([{ optionId: 'opt-1', locationId: 'office', quantity: 30 }], {
      ownStockIn: true,
    })
    expect(res?.status).toBe(409)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })
})

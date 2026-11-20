/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const mockApplyBatchInbound = jest.fn()
const tx = {
  $queryRaw: jest.fn(),
  productionRun: { findUnique: jest.fn() },
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('../route') as typeof import('../route')

const stockedInAt = new Date('2026-11-13T00:00:00Z')
const loc = (id: string, type = 'OWN', externalSource: string | null = null) => ({
  id,
  name: id,
  type,
  externalSource,
  isActive: true,
})

function setup(status = 'STOCKED_IN') {
  const run = {
    id: 'run-1',
    runNo: 'R1',
    status,
    stockedInAt,
    brand: null,
    externalStockIns: [
      { optionId: 'opt-1', locationId: 'office', quantity: 30 },
      { optionId: 'opt-1', locationId: 'wekeep', quantity: 70 },
    ],
    items: [
      {
        optionId: 'opt-1',
        option: { name: 'o', product: { name: 'p', internalName: null } },
      },
    ],
  }
  mockPrisma.productionRun.findFirst.mockResolvedValue(run)
  tx.productionRun.findUnique.mockResolvedValue(run)
  mockPrisma.invStorageLocation.findMany.mockResolvedValue([
    loc('office'),
    loc('wekeep', 'THIRD_PARTY'),
  ])
  mockPrisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx))
  mockApplyBatchInbound.mockResolvedValue([
    { optionId: 'opt-1', locationId: 'office', stockLevelAfter: 25 },
  ])
}

const call = (entries: unknown[], movementDate = '2026-11-20') =>
  POST(
    new NextRequest('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ movementDate, entries }),
    }),
    { params: Promise.resolve({ runId: 'run-1' }) }
  )
const own = { optionId: 'opt-1', locationId: 'office', quantity: 25 }

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
  setup()
})

describe('POST own-stock-in', () => {
  it('정상: 수정한 수량으로 INBOUND, 행 잠금 후 처리', async () => {
    const res = await call([own])
    expect(res?.status).toBe(200)
    const items = mockApplyBatchInbound.mock.calls[0][2]
    expect(items).toEqual([
      expect.objectContaining({
        locationId: 'office',
        quantity: 25,
        referenceId: 'prodrun:run-1:opt-1:office',
      }),
    ])
    expect(mockApplyBatchInbound.mock.calls[0][3]).toEqual(new Date('2026-11-20'))
    // 차수 행 + 위치 행 잠금
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3)
  })

  it('요청 내 같은 옵션·위치 중복은 400', async () => {
    expect((await call([own, own]))?.status).toBe(400)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })

  it('수량 0·음수·소수는 400', async () => {
    expect((await call([{ ...own, quantity: 0 }]))?.status).toBe(400)
    expect((await call([{ ...own, quantity: 1.5 }]))?.status).toBe(400)
  })

  it('이미 등록된 키는 409', async () => {
    registered = [
      { referenceId: 'prodrun:run-1:opt-1:office', quantity: 30, movementDate: new Date() },
    ]
    expect((await call([own]))?.status).toBe(409)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })

  it('외부 위치는 400', async () => {
    const res = await call([{ optionId: 'opt-1', locationId: 'wekeep', quantity: 5 }])
    expect(res?.status).toBe(400)
  })

  it('분배에 없는 옵션·위치는 400', async () => {
    const res = await call([{ optionId: 'opt-1', locationId: 'other', quantity: 5 }])
    expect(res?.status).toBe(400)
  })

  it('입고 완료가 아닌 차수는 409', async () => {
    setup('ORDERED')
    expect((await call([own]))?.status).toBe(409)
  })

  it('입고 이후 확정 대조가 있는 위치는 409', async () => {
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc0',
        status: 'CONFIRMED',
        locationId: 'office',
        confirmedAt: new Date('2026-11-14T00:00:00Z'),
        createdAt: stockedInAt,
      },
    ])
    const res = await call([own])
    expect(res?.status).toBe(409)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })

  it('입고 이전 대조는 막지 않는다', async () => {
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        locationId: 'office',
        confirmedAt: new Date('2026-11-12T00:00:00Z'),
        createdAt: stockedInAt,
      },
    ])
    expect((await call([own]))?.status).toBe(200)
  })

  it('PARTIAL 대조의 ADJUSTMENT 가 입고 이후 적용됐으면 409', async () => {
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc1',
        status: 'PARTIAL',
        locationId: 'office',
        confirmedAt: null,
        createdAt: stockedInAt,
      },
    ])
    adjustments = [
      { locationId: 'office', referenceId: 'rc1', createdAt: new Date('2026-11-16T00:00:00Z') },
    ]
    expect((await call([own]))?.status).toBe(409)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })

  it('확정 중인 PENDING 대조의 ADJUSTMENT 가 입고 이후 적용됐으면 409', async () => {
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc2',
        status: 'PENDING',
        locationId: 'office',
        confirmedAt: null,
        createdAt: stockedInAt,
      },
    ])
    adjustments = [
      { locationId: 'office', referenceId: 'rc2', createdAt: new Date('2026-11-16T00:00:00Z') },
    ]
    expect((await call([own]))?.status).toBe(409)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })

  it('조정이 아직 없는 PENDING 대조만 있으면 막지 않는다', async () => {
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc3',
        status: 'PENDING',
        locationId: 'office',
        confirmedAt: null,
        createdAt: new Date('2026-11-16T00:00:00Z'),
      },
    ])
    expect((await call([own]))?.status).toBe(200)
  })

  it('ADJUSTMENT 가 대조 소속이 아니면(수동 조정) 막지 않는다', async () => {
    adjustments = [
      {
        locationId: 'office',
        referenceId: 'manual-1',
        createdAt: new Date('2026-11-16T00:00:00Z'),
      },
    ]
    expect((await call([own]))?.status).toBe(200)
  })

  it('같은 날(KST) 대조는 자체 위치 등록을 막지 않는다', async () => {
    tx.invReconciliation.findMany.mockResolvedValue([
      {
        id: 'rc1',
        status: 'CONFIRMED',
        locationId: 'office',
        confirmedAt: new Date('2026-11-13T10:00:00Z'),
        createdAt: stockedInAt,
      },
    ])
    expect((await call([own]))?.status).toBe(200)
  })

  it('잠근 뒤 다시 읽은 분배에 없으면 400', async () => {
    tx.productionRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'STOCKED_IN',
      stockedInAt,
      externalStockIns: [],
    })
    expect((await call([own]))?.status).toBe(400)
    expect(mockApplyBatchInbound).not.toHaveBeenCalled()
  })
})

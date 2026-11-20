/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

const tx = {
  $queryRaw: jest.fn(),
  productionRun: { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn() },
  invMovement: { findMany: jest.fn() },
  invReconciliation: { findMany: jest.fn() },
  invStorageLocation: { findMany: jest.fn() },
}
const mockPrisma = {
  productionRun: { findFirst: jest.fn(), delete: jest.fn() },
  $transaction: jest.fn(),
}

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 'space-1' } })),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
jest.mock('@/lib/inv/movement-processor', () => ({
  MovementError: class MovementError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PATCH, DELETE } = require('../route') as typeof import('../route')

const ctx = { params: Promise.resolve({ runId: 'run-1' }) }
const stockedRun = {
  id: 'run-1',
  status: 'STOCKED_IN',
  stockedInAt: new Date('2026-11-13T00:00:00Z'),
  externalStockIns: [{ optionId: 'opt-1', locationId: 'office', quantity: 5 }],
}

let registered: unknown[] = []

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx))
  tx.$queryRaw.mockResolvedValue([])
  registered = []
  tx.invMovement.findMany.mockImplementation(async (a: { where: { type?: string } }) =>
    a.where.type === 'ADJUSTMENT' ? [] : registered
  )
  tx.invReconciliation.findMany.mockResolvedValue([])
  tx.invStorageLocation.findMany.mockResolvedValue([
    { id: 'office', type: 'OWN', externalSource: null },
  ])
  tx.productionRun.findUnique.mockResolvedValue(stockedRun)
})

const patch = (body: Record<string, unknown>) =>
  PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }), ctx)

describe('PATCH — 상태는 바꾸지 않는다', () => {
  it('STOCKED_IN → ORDERED 시도는 400', async () => {
    mockPrisma.productionRun.findFirst.mockResolvedValue({
      id: 'run-1',
      costMode: 'TOTAL',
      status: 'STOCKED_IN',
    })
    const res = await patch({ status: 'ORDERED' })
    expect(res?.status).toBe(400)
    expect(tx.productionRun.update).not.toHaveBeenCalled()
  })

  it('ORDERED → STOCKED_IN 직접 시도도 400', async () => {
    mockPrisma.productionRun.findFirst.mockResolvedValue({
      id: 'run-1',
      costMode: 'TOTAL',
      status: 'ORDERED',
    })
    expect((await patch({ status: 'STOCKED_IN' }))?.status).toBe(400)
  })

  it('같은 상태를 보내면 통과하되 status 는 갱신 데이터에 포함되지 않는다', async () => {
    mockPrisma.productionRun.findFirst.mockResolvedValue({
      id: 'run-1',
      costMode: 'TOTAL',
      status: 'ORDERED',
    })
    const res = await patch({ status: 'ORDERED', memo: 'm' })
    expect(res?.status).toBe(200)
    expect(tx.productionRun.update.mock.calls[0][0].data).not.toHaveProperty('status')
  })
})

describe('DELETE', () => {
  const del = () => DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), ctx)
  beforeEach(() => {
    mockPrisma.productionRun.findFirst.mockResolvedValue({ id: 'run-1', status: 'STOCKED_IN' })
  })

  it('입고 완료 차수도 등록된 입고·대조가 없으면 삭제', async () => {
    expect((await del())?.status).toBe(200)
    expect(tx.productionRun.delete).toHaveBeenCalled()
  })

  it('등록된 입고가 있으면 409', async () => {
    registered = [
      { referenceId: 'prodrun:run-1:opt-1:office', quantity: 5, movementDate: new Date() },
    ]
    expect((await del())?.status).toBe(409)
    expect(tx.productionRun.delete).not.toHaveBeenCalled()
  })

  it('분배 기록이 없으면 409', async () => {
    tx.productionRun.findUnique.mockResolvedValue({ ...stockedRun, externalStockIns: null })
    expect((await del())?.status).toBe(409)
  })
})

describe('PATCH — 입고 완료 차수 보호', () => {
  const stocked = {
    id: 'run-1',
    costMode: 'TOTAL',
    status: 'STOCKED_IN',
    stockedInAt: new Date('2026-11-13T00:00:00Z'),
    completedAt: new Date('2026-11-13T00:00:00Z'),
    externalStockIns: [{ optionId: 'opt-1', locationId: 'office', quantity: 5 }],
  }
  beforeEach(() => mockPrisma.productionRun.findFirst.mockResolvedValue(stocked))

  it('stockedInAt 변경은 400', async () => {
    expect((await patch({ stockedInAt: '2026-11-20' }))?.status).toBe(400)
    expect(tx.productionRun.update).not.toHaveBeenCalled()
  })

  it('completedAt 변경은 400', async () => {
    expect((await patch({ completedAt: null }))?.status).toBe(400)
  })

  it('같은 날짜를 그대로 보내면 통과', async () => {
    expect((await patch({ stockedInAt: '2026-11-13' }))?.status).toBe(200)
  })

  it('분배가 기록된 옵션을 items 에서 빼면 400', async () => {
    const res = await patch({ items: [{ optionId: 'opt-2', quantity: 3 }] })
    expect(res?.status).toBe(400)
  })
})

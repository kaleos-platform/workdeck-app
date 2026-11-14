/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { matchReconciliation } from '../reconciliation-matcher'
import { runReconciliationMatch } from '../reconciliation-core'
import type { ParseResult } from '../reconciliation-parser'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStorageLocation: { findFirst: jest.fn(), findMany: jest.fn() },
    invReconciliation: { create: jest.fn(), updateMany: jest.fn() },
  },
}))
jest.mock('../reconciliation-matcher', () => ({ matchReconciliation: jest.fn() }))

const selected = { id: 'warehouse', name: '본사', isActive: true }
const named = { id: 'threepl', name: '3PL', isActive: true }
const parsed: ParseResult = {
  format: 'stock_status_export',
  rows: [
    { externalName: '상품 A', externalOptionName: 'S', externalLocationName: '3PL', quantity: 3 },
    { externalName: '상품 B', externalOptionName: 'M', quantity: 5 },
  ],
}

function run(locationId: string | null = selected.id, data = parsed) {
  return runReconciliationMatch({
    spaceId: 'space',
    parsed: data,
    locationId,
    fileName: '재고조정.xlsx',
  })
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(prisma.invStorageLocation.findFirst).mockResolvedValue(selected as never)
  jest.mocked(prisma.invStorageLocation.findMany).mockResolvedValue([selected, named] as never)
  jest.mocked(prisma.invReconciliation.updateMany).mockResolvedValue({ count: 0 })
  jest.mocked(prisma.invReconciliation.create).mockResolvedValue({ id: 'reconciliation' } as never)
  jest
    .mocked(matchReconciliation)
    .mockResolvedValue({ entries: [], totalItems: 1, matchedItems: 1 })
})

it('파일에 위치가 있는 행은 유지하고 빈 행에만 선택한 보관 장소를 적용한다', async () => {
  await run()
  const calls = jest.mocked(matchReconciliation).mock.calls
  expect(
    calls.map(([, locationId, data]) => [locationId, data.rows.map((r) => r.externalName)])
  ).toEqual([
    ['threepl', ['상품 A']],
    ['warehouse', ['상품 B']],
  ])
  expect(parsed.rows[1].externalLocationName).toBeUndefined()
  expect(prisma.invStorageLocation.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'warehouse', spaceId: 'space' },
    })
  )
})

it('모든 위치가 비어 있는 템플릿도 선택한 보관 장소에서 분석한다', async () => {
  await run(selected.id, { ...parsed, rows: [parsed.rows[1]] })
  expect(matchReconciliation).toHaveBeenCalledWith(
    'space',
    'warehouse',
    expect.objectContaining({
      rows: [expect.objectContaining({ externalLocationName: '본사', quantity: 5 })],
    })
  )
})

it('위치가 빈 행이 있는데 선택하지 않으면 위치 선택을 요청하고 대조를 생성하지 않는다', async () => {
  await expect(run(null)).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' })
  expect(prisma.invReconciliation.create).not.toHaveBeenCalled()
})

it('다른 Space의 위치를 선택하면 거부한다', async () => {
  jest.mocked(prisma.invStorageLocation.findFirst).mockResolvedValue(null)
  await expect(run()).rejects.toMatchObject({ code: 'LOCATION_NOT_FOUND' })
  expect(matchReconciliation).not.toHaveBeenCalled()
})

it('비활성 보관 장소를 선택하면 거부한다', async () => {
  jest
    .mocked(prisma.invStorageLocation.findFirst)
    .mockResolvedValue({ ...selected, isActive: false } as never)
  await expect(run()).rejects.toMatchObject({ code: 'LOCATION_INACTIVE' })
  expect(prisma.invReconciliation.create).not.toHaveBeenCalled()
})

it('모든 행에 위치가 있으면 보관 장소를 선택하지 않아도 파일 위치로 분배한다', async () => {
  await run(null, { ...parsed, rows: [parsed.rows[0]] })
  expect(matchReconciliation).toHaveBeenCalledWith(
    'space',
    'threepl',
    expect.objectContaining({
      rows: [parsed.rows[0]],
    })
  )
})

it('일반 파일은 기존과 같이 선택한 단일 보관 장소에서 분석한다', async () => {
  const generic: ParseResult = { format: 'generic', rows: [{ externalCode: 'SKU', quantity: 2 }] }
  await run(selected.id, generic)
  expect(matchReconciliation).toHaveBeenCalledWith('space', selected.id, generic)
})

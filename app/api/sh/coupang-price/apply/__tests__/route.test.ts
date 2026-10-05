/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'
import { computePriceTargets } from '@/lib/sh/coupang-price/compute-targets'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { ...actual, resolveDeckContext: jest.fn() }
})
jest.mock('@/lib/coupang/workspace-space', () => ({
  requireCoupangWorkspaceId: async () => 'ws-1',
}))
jest.mock('@/lib/sh/coupang-price/compute-targets', () => {
  const actual = jest.requireActual('@/lib/sh/coupang-price/compute-targets')
  return { ...actual, computePriceTargets: jest.fn() }
})
jest.mock('@/lib/prisma', () => ({
  prisma: { coupangWriteJob: { findFirst: jest.fn(), create: jest.fn() } },
}))

const job = prisma.coupangWriteJob as unknown as { findFirst: jest.Mock; create: jest.Mock }
const body = {
  channelId: 'ch',
  rows: [{ optionIds: ['A1'], quantity: 1 }],
  salePrice: 20_000,
  minMarginPrice: 15_000,
  includeVat: true,
}
const target = (over: Record<string, unknown> = {}) => ({
  listingId: 'L1',
  listingName: 'A1',
  vendorItemId: 'rg-1',
  currentPrice: 21_000,
  snapshotAgeHours: 1,
  targetPrice: 20_000,
  apMinSalePrice: 15_000,
  deltaPct: -0.05,
  blockedReason: null,
  sellerProductId: 'sp',
  ...over,
})
const call = async (extra: Record<string, unknown> = {}) =>
  (await POST(
    new NextRequest('http://localhost/api/sh/coupang-price/apply', {
      method: 'POST',
      body: JSON.stringify({ ...body, ...extra }),
    })
  ))!

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'space-1' }, role: 'ADMIN' })
  ;(computePriceTargets as jest.Mock).mockResolvedValue({
    channelId: 'ch',
    channelAxis: 'RG',
    targets: [target(), target({ listingId: 'L2', vendorItemId: null, blockedReason: '연결 안 됨' })],
    ambiguous: [],
    unmatched: [],
  })
  job.findFirst.mockResolvedValue(null)
  job.create.mockResolvedValue({ id: 'job-1' })
})

test('반영 가능한 타깃만 담아 apActive=true 잡을 승인 없이 만든다', async () => {
  const res = await call()
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ job: { id: 'job-1', targets: 1 } })
  const data = job.create.mock.calls[0][0].data
  expect(data).toMatchObject({ workspaceId: 'ws-1', spaceId: 'space-1', kind: 'PRICE_CHANGE' })
  expect(data.actionId).toBeUndefined()
  expect(data.payload).toEqual({
    channelAxis: 'RG',
    channelId: 'ch',
    apActive: true,
    targets: [
      { listingId: 'L1', vendorItemId: 'rg-1', listingName: 'A1', currentPrice: 21_000, targetPrice: 20_000, apMinSalePrice: 15_000 },
    ],
  })
})

test('진행 중인 가격 반영 잡이 있으면 409 — 연타·다른 카드 동시 반영 차단', async () => {
  job.findFirst.mockResolvedValue({ id: 'job-0' })
  const res = await call()
  expect(res.status).toBe(409)
  expect(job.create).not.toHaveBeenCalled()
})

test('MEMBER 는 403', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'space-1' }, role: 'MEMBER' })
  expect((await call()).status).toBe(403)
})

test('반영 가능한 타깃이 0개면 400', async () => {
  ;(computePriceTargets as jest.Mock).mockResolvedValue({
    channelId: 'ch', channelAxis: 'RG', targets: [target({ blockedReason: 'VAT 미포함' })], ambiguous: [], unmatched: [],
  })
  expect((await call()).status).toBe(400)
})

test('미리보기 이후 반영 대상이 바뀌면 409 — 사용자가 못 본 대상이 끼어들지 않게', async () => {
  const res = await call({ expectedListingIds: ['L1', 'L9'] })
  expect(res.status).toBe(409)
  expect((await res.json()).message).toBe('미리보기 이후 반영 대상이 바뀌었습니다. 미리보기를 다시 불러온 뒤 시도하세요')
  expect(job.findFirst).not.toHaveBeenCalled()
  expect(job.create).not.toHaveBeenCalled()
})

test('미리보기 대상과 같으면 그대로 반영', async () => {
  expect((await call({ expectedListingIds: ['L1'] })).status).toBe(201)
})

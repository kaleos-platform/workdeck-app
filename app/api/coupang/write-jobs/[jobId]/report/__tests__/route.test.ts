/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/collection/resolve-workspace', () => ({
  resolveCollectionAuth: async () => ({ kind: 'worker', workspaceId: 'ws-1' }),
}))
jest.mock('@/lib/prisma', () => {
  const tx = {
    coupangWriteJob: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    coupangProductItem: { updateMany: jest.fn() },
    productListing: { updateMany: jest.fn() },
  }
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})
const p = prisma as unknown as {
  $transaction: jest.Mock
  __tx: {
    coupangWriteJob: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock }
    coupangProductItem: { updateMany: jest.Mock }
    productListing: { updateMany: jest.Mock }
  }
}

const report = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ jobId: 'job-1' }),
  })
const jobWith = (channelAxis: 'RG' | 'MP') => ({
  id: 'job-1',
  spaceId: 'space-1',
  kind: 'PRICE_CHANGE',
  payload: {
    channelAxis,
    targets: [
      { listingId: 'L1', vendorItemId: 'v1', targetPrice: 20_000 },
      { listingId: 'L2', vendorItemId: 'v2', targetPrice: 20_000 },
    ],
  },
})
const results = [
  { listingId: 'L1', vendorItemId: 'v1', ok: true, error: null },
  { listingId: 'L2', vendorItemId: 'v2', ok: false, error: '쿠팡 거부' },
]

beforeEach(() => {
  jest.clearAllMocks()
  p.__tx.coupangWriteJob.updateMany.mockResolvedValue({ count: 1 })
})

test('판매자배송 축 성공 타깃만 워크덱 판매가를 갱신한다', async () => {
  p.__tx.coupangWriteJob.findUniqueOrThrow.mockResolvedValue(jobWith('MP'))
  await report({ status: 'PARTIAL', results })
  expect(p.__tx.productListing.updateMany).toHaveBeenCalledTimes(1)
  expect(p.__tx.productListing.updateMany).toHaveBeenCalledWith({
    where: { id: 'L1', spaceId: 'space-1' },
    data: { retailPrice: 20_000 },
  })
  expect(p.__tx.coupangProductItem.updateMany).toHaveBeenCalledWith({
    where: { spaceId: 'space-1', mpVendorItemId: 'v1' },
    data: { mpSalePrice: 20_000 },
  })
})

test('로켓그로스 축은 워크덱 판매가를 건드리지 않는다', async () => {
  p.__tx.coupangWriteJob.findUniqueOrThrow.mockResolvedValue(jobWith('RG'))
  await report({ status: 'PARTIAL', results })
  expect(p.__tx.productListing.updateMany).not.toHaveBeenCalled()
  expect(p.__tx.coupangProductItem.updateMany).toHaveBeenCalledWith({
    where: { spaceId: 'space-1', rgVendorItemId: 'v1' },
    data: { rgSalePrice: 20_000 },
  })
})

test('알 수 없는 status 는 400 — 500 이면 워커가 보고 실패로 보고 잡이 RUNNING 에 갇힌다', async () => {
  const res = await report({ status: 'DONE', results })
  expect(res.status).toBe(400)
  expect(p.__tx.coupangWriteJob.updateMany).not.toHaveBeenCalled()
})

test('RUNNING 이 아니면(이미 회수됨) stale — 결과·가격 아무것도 안 쓴다, 게이트는 트랜잭션 안', async () => {
  p.__tx.coupangWriteJob.updateMany.mockResolvedValue({ count: 0 })
  const res = await report({ status: 'SUCCEEDED', results })
  expect(await res.json()).toEqual({ ok: false, stale: true })
  expect(p.$transaction).toHaveBeenCalledTimes(1)
  expect(p.__tx.coupangWriteJob.findUniqueOrThrow).not.toHaveBeenCalled()
  expect(p.__tx.coupangProductItem.updateMany).not.toHaveBeenCalled()
  expect(p.__tx.productListing.updateMany).not.toHaveBeenCalled()
})

test('잡 타깃과 vendorItemId 가 다른 보고는 가격을 쓰지 않는다', async () => {
  p.__tx.coupangWriteJob.findUniqueOrThrow.mockResolvedValue(jobWith('MP'))
  await report({ status: 'SUCCEEDED', results: [{ listingId: 'L1', vendorItemId: 'other', ok: true, error: null }] })
  expect(p.__tx.coupangProductItem.updateMany).not.toHaveBeenCalled()
  expect(p.__tx.productListing.updateMany).not.toHaveBeenCalled()
})

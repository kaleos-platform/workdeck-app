/** @jest-environment node */
/**
 * 스윕 Space 격리 — 실제 라우트 + 로컬 Supabase, mock 없음(Slack 알림만 차단).
 * Space A·B 를 처리 가능한 같은 모양(활성 Deck·워크스페이스 연결·매핑·판매채널·스냅샷)으로 시드한다.
 *  - A 토큰 호출은 A 만 처리·응답(집계 포함)하고 B 의 재고·이동은 바꾸지 않는다. B 도 대칭.
 *  - 워크스페이스 연결을 다른 Space 와 공유하는 C 의 토큰 스윕은 그 Space 를 건너뛴다(엄격 해석).
 *  - CRON_SECRET·레거시 키는 기존처럼 전체 스윕 — A·B 모두 처리한다.
 * runCoupangSalesSyncForDates·runInventorySync 의 spaceId 필터를 지우면 두 Space 가 모두 나와 실패한다.
 * 전체 스윕 케이스는 로컬 DB 의 다른 Space 도 처리한다 — 로컬 Supabase 에서만 돈다.
 */
import path from 'path'
import { config } from 'dotenv'

// next/jest 는 테스트 모드에서 .env.local 을 읽지 않는다 — 기존 e2e 와 같이 직접 읽는다.
config({ path: path.resolve(process.cwd(), '.env.local') })

jest.mock('@/lib/slack-inventory-notifier', () => ({
  notifyAutoReconciliation: jest.fn().mockResolvedValue(false),
}))

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateWorkerToken, workerTokenExpiry } from '@/lib/worker-auth'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { GET as salesSync } from '../../../../app/api/cron/coupang-sales-sync/route'
import { GET as inventorySync } from '../../../../app/api/cron/coupang-inventory-sync/route'

const url = process.env.DATABASE_URL ?? ''
const RUN = /@(127\.0\.0\.1|localhost):/.test(url)
if (process.env.CI && !RUN) throw new Error('CI 에서는 로컬 Supabase DATABASE_URL 이 필요합니다')
const d = RUN ? describe : describe.skip

const A = 'e2e-sweep-space-a'
const B = 'e2e-sweep-space-b'
const C = 'e2e-sweep-space-c' // D 와 워크스페이스 연결을 공유 — 토큰 스윕에서 모호
const D = 'e2e-sweep-space-d'
const SPACES = [A, B, C, D]
const SALE_DAY = '2026-03-01'
const SNAPSHOT = new Date('2026-03-01T03:30:00.000Z')
const SALES_QTY: Record<string, number> = { [A]: 3, [B]: 5 }
const tokens: Record<string, string> = {}
const savedEnv = {
  CRON_SECRET: process.env.CRON_SECRET,
  WORKER_API_KEY: process.env.WORKER_API_KEY,
  WORKER_LEGACY_KEY_ENABLED: process.env.WORKER_LEGACY_KEY_ENABLED,
}

const userId = (s: string) => `${s}-user`
const workspaceId = (s: string) => (s === C || s === D ? 'e2e-sweep-ws-cd' : `${s}-ws`)

async function cleanup() {
  const spaceId = { in: SPACES }
  await prisma.invMovement.deleteMany({ where: { spaceId } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId } })
  await prisma.invReconciliation.deleteMany({ where: { spaceId } })
  await prisma.invLocationProductMapItem.deleteMany({ where: { map: { spaceId } } })
  await prisma.invLocationProductMap.deleteMany({ where: { spaceId } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId } } })
  await prisma.invProduct.deleteMany({ where: { spaceId } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId } })
  await prisma.channel.deleteMany({ where: { spaceId } })
  await prisma.deckInstance.deleteMany({ where: { spaceId } })
  await prisma.workerHeartbeat.deleteMany({
    where: { OR: SPACES.map((s) => ({ service: { endsWith: `:${s}` } })) },
  })
  // InventoryUpload/Record·CoupangBackfillJob 은 Workspace cascade, Workspace 는 User cascade
  await prisma.user.deleteMany({ where: { id: { in: SPACES.map(userId) } } })
  await prisma.space.deleteMany({ where: { id: spaceId } }) // 토큰은 Cascade
}

/** processable 이면 판매 변환·재고 대조가 실제로 도는 Space(활성 Deck·판매채널·매핑·스냅샷), 아니면 위치(연결)만. */
async function seed(spaceId: string, opts: { processable: boolean }) {
  await prisma.space.create({ data: { id: spaceId, name: spaceId, type: 'PERSONAL' } })
  const ws = workspaceId(spaceId)
  if (!(await prisma.workspace.findUnique({ where: { id: ws } }))) {
    await prisma.user.create({ data: { id: userId(spaceId), email: `${spaceId}@throwaway.test` } })
    await prisma.workspace.create({ data: { id: ws, ownerId: userId(spaceId), name: ws } })
  }
  const loc = await prisma.invStorageLocation.create({
    data: {
      spaceId,
      name: '로켓그로스',
      type: 'THIRD_PARTY',
      isActive: true,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      externalIntegrationKey: ws,
    },
  })
  if (!opts.processable) return

  await prisma.deckInstance.create({
    data: { spaceId, deckAppId: 'coupang-ads', isActive: true },
  })
  await prisma.channel.create({
    data: {
      spaceId,
      name: '쿠팡 로켓그로스',
      isActive: true,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
    },
  })
  const group = await prisma.invProductGroup.create({ data: { spaceId, name: '기본' } })
  const product = await prisma.invProduct.create({
    data: { spaceId, name: `${spaceId} 상품`, groupId: group.id, status: 'ACTIVE' },
  })
  const option = await prisma.invProductOption.create({
    data: { productId: product.id, name: '기본옵션' },
  })
  const code = `SKU-${spaceId}`
  const map = await prisma.invLocationProductMap.create({
    data: { spaceId, locationId: loc.id, externalCode: code },
  })
  await prisma.invLocationProductMapItem.create({
    data: { mapId: map.id, optionId: option.id, quantity: 1 },
  })

  const record = { workspaceId: ws, productId: 'P1', optionId: `O-${spaceId}`, skuId: code }
  const health = await prisma.inventoryUpload.create({
    data: {
      workspaceId: ws,
      fileName: 'health.xlsx',
      fileType: 'INVENTORY_HEALTH',
      snapshotDate: SNAPSHOT,
      totalRows: 1,
      insertedRows: 1,
    },
  })
  await prisma.inventoryRecord.create({
    data: {
      ...record,
      uploadId: health.id,
      snapshotDate: SNAPSHOT,
      fileType: 'INVENTORY_HEALTH',
      productName: '상품',
      optionName: '기본옵션',
      availableStock: 100,
    },
  })
  const saleDate = new Date(`${SALE_DAY}T00:00:00+09:00`)
  const vendor = await prisma.inventoryUpload.create({
    data: {
      workspaceId: ws,
      fileName: 'vendor.xlsx',
      fileType: 'VENDOR_ITEM_METRICS',
      snapshotDate: saleDate,
      totalRows: 1,
      insertedRows: 1,
    },
  })
  await prisma.inventoryRecord.create({
    data: {
      ...record,
      uploadId: vendor.id,
      snapshotDate: saleDate,
      fileType: 'VENDOR_ITEM_METRICS',
      productName: '상품',
      fulfillmentType: '로켓그로스',
      salesQty30d: SALES_QTY[spaceId] ?? 1,
      revenue30d: (SALES_QTY[spaceId] ?? 1) * 10_000,
      orderCount: SALES_QTY[spaceId] ?? 1,
    },
  })
}

async function issueToken(spaceId: string) {
  const { token, tokenHash } = generateWorkerToken()
  await prisma.workerToken.create({
    data: { spaceId, name: 'e2e', tokenHash, expiresAt: workerTokenExpiry(1) },
  })
  tokens[spaceId] = token
}

/** 다른 Space 가 바뀌지 않았는지 보는 지문 — 재고·이동·대조. */
async function fingerprint(spaceId: string) {
  const [stock, movements, recons] = await Promise.all([
    prisma.invStockLevel.findMany({
      where: { spaceId },
      select: { optionId: true, quantity: true },
    }),
    prisma.invMovement.count({ where: { spaceId } }),
    prisma.invReconciliation.count({ where: { spaceId } }),
  ])
  return { stock, movements, recons }
}

type SweepBody = {
  spaces: Array<{ spaceId: string; status: string }>
  totals?: { salesQty: number; orderCount: number; revenue: number }
}

const ROUTES = [
  ['판매 변환', salesSync, `/api/cron/coupang-sales-sync?from=${SALE_DAY}&to=${SALE_DAY}`],
  ['재고 대조', inventorySync, '/api/cron/coupang-inventory-sync'],
] as const

async function call(
  handler: (typeof ROUTES)[number][1],
  path: string,
  headers: Record<string, string>
) {
  const res = await handler(new NextRequest(`http://t${path}`, { headers }))
  return { status: res.status, body: (await res.json()) as SweepBody }
}

d('스윕 Space 격리 (로컬 Supabase)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.deckApp.upsert({
      where: { id: 'coupang-ads' },
      create: { id: 'coupang-ads', name: '쿠팡 광고 관리' },
      update: {},
    })
    await seed(A, { processable: true })
    await seed(B, { processable: true })
    await seed(C, { processable: true })
    await seed(D, { processable: false })
    for (const s of [A, B, C]) await issueToken(s)
  })

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await cleanup()
    await prisma.$disconnect()
  })

  test.each(ROUTES)(
    '%s: Space 토큰은 자기 Space 만 처리·응답하고 다른 Space 는 바꾸지 않는다',
    async (name, handler, path) => {
      // B 는 대조군 — A 만 보면 "아무것도 안 돌았다"도 통과할 수 있다.
      for (const [own, other] of [
        [A, B],
        [B, A],
      ]) {
        const before = await fingerprint(other)
        const { status, body } = await call(handler, path, { 'x-worker-api-key': tokens[own] })
        expect(status).toBe(200)
        expect(body.spaces).toEqual([expect.objectContaining({ spaceId: own, status: 'ok' })])
        if (name === '판매 변환') {
          expect(body.totals).toEqual({
            converted: 1,
            revenue: SALES_QTY[own] * 10_000,
            orderCount: SALES_QTY[own],
            salesQty: SALES_QTY[own],
          })
          expect(
            await prisma.invMovement.count({ where: { spaceId: own, type: 'OUTBOUND' } })
          ).toBe(1)
        } else {
          expect(await prisma.invReconciliation.count({ where: { spaceId: own } })).toBe(1)
        }
        expect(await fingerprint(other)).toEqual(before)
        // 멈춘 Space 가 전역 하트비트에 가려지지 않게 Space 별 키가 남는다.
        const service = path.includes('sales') ? 'coupang-sales-sync' : 'coupang-inventory-sync'
        expect(
          await prisma.workerHeartbeat.findUnique({ where: { service: `${service}:${own}` } })
        ).not.toBeNull()
      }
    }
  )

  test.each(ROUTES)(
    '%s: 워크스페이스 연결을 다른 Space 와 공유하면 토큰 스윕은 건너뛴다',
    async (_name, handler, path) => {
      const before = await fingerprint(C)
      const { status, body } = await call(handler, path, { 'x-worker-api-key': tokens[C] })
      expect(status).toBe(200)
      expect(body.spaces).toEqual([{ spaceId: C, status: 'skip:no-workspace-link' }])
      expect(await fingerprint(C)).toEqual(before)
    }
  )

  test.each(ROUTES)(
    '%s: 유효한 CRON_SECRET 은 전체 스윕(A·B 모두)',
    async (_name, handler, path) => {
      process.env.CRON_SECRET = 'e2e-cron-secret'
      const { status, body } = await call(handler, path, {
        authorization: 'Bearer e2e-cron-secret',
      })
      expect(status).toBe(200)
      const processed = body.spaces.filter(
        (s) => s.status === 'ok' || s.status === 'skip:already-applied'
      )
      expect(processed.map((s) => s.spaceId)).toEqual(expect.arrayContaining([A, B]))
    }
  )

  test.each(ROUTES)('%s: 레거시 키는 전체 스윕(A·B 모두)', async (_name, handler, path) => {
    process.env.WORKER_API_KEY = 'e2e-legacy-sweep-key'
    process.env.WORKER_LEGACY_KEY_ENABLED = '1'
    const { status, body } = await call(handler, path, {
      'x-worker-api-key': 'e2e-legacy-sweep-key',
    })
    expect(status).toBe(200)
    const processed = body.spaces.filter(
      (s) => s.status === 'ok' || s.status === 'skip:already-applied'
    )
    expect(processed.map((s) => s.spaceId)).toEqual(expect.arrayContaining([A, B]))
  })

  test.each(ROUTES)(
    '%s: 틀린 CRON_SECRET 이고 워커 토큰이 없으면 401',
    async (_name, handler, path) => {
      process.env.CRON_SECRET = 'e2e-cron-secret'
      const { status } = await call(handler, path, { authorization: 'Bearer wrong' })
      expect(status).toBe(401)
    }
  )
})

/**
 * deleteBatchWithMovements — MANUAL 배치 삭제 시 channelStock 복원 e2e.
 *
 * MANUAL 배치가 COMPLETED 되면 ChannelStockMovement 원장 행이 생성되고
 * productListing.channelStock이 decrement 된다. 이후 배치를 DELETE 하면
 * cascade로 원장 행이 사라지지만 channelStock이 복원되어야 한다(감사 Medium).
 *
 * throwaway space/user(고유 hex UUID)에 최소 시드를 구성하고
 * PATCH(COMPLETED) → DELETE 순서로 라우트를 호출해 복원을 단언한다.
 * afterAll cascade로 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})

import { resolveDeckContext } from '@/lib/api-helpers'
import { PATCH, DELETE } from '../../../../app/api/sh/shipping/batches/[batchId]/route'

// 고유 throwaway ID — 다른 e2e 테스트와 충돌 없도록 독립된 hex UUID
const SPACE_ID = 'e2ecs000-0000-4000-8000-00000000cs01'
const USER_ID = 'e2ecs000-0000-4000-8000-00000000cs02'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let batchId = ''
let listingId = ''

async function cleanup() {
  // ChannelStockMovement / DelOrderItem / DelOrder / DelBatch — DelBatch cascade로 연쇄 삭제
  await prisma.delBatch.deleteMany({ where: { spaceId: SPACE_ID } })
  // ProductListing cascade 삭제 전에 DelOrderItem.listingId FK가 SetNull 처리됨 (schema onDelete:SetNull)
  await prisma.productListing.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteReq() {
  return new NextRequest('http://localhost/x', { method: 'DELETE' })
}

d(
  'DELETE /api/sh/shipping/batches/[batchId] — MANUAL 배치 삭제 시 channelStock 복원 (dev DB)',
  () => {
    beforeAll(async () => {
      await cleanup()

      // Space / User
      await prisma.space.create({
        data: { id: SPACE_ID, name: 'E2E ChStockRestore', type: 'PERSONAL' },
      })
      await prisma.user.create({
        data: { id: USER_ID, email: 'e2e-chstock-restore@throwaway.test' },
      })

      // 상품 계층 — ProductListing을 만들기 위한 최소 구조
      const group = await prisma.invProductGroup.create({
        data: { spaceId: SPACE_ID, name: '기본' },
      })
      const product = await prisma.invProduct.create({
        data: { spaceId: SPACE_ID, name: 'E2E 채널재고상품', groupId: group.id, status: 'ACTIVE' },
      })
      await prisma.invProductOption.create({
        data: { productId: product.id, name: 'A' },
      })

      // Channel — externalSource=null (통합재고 채널, channelStock 차감 대상)
      const channel = await prisma.channel.create({
        data: { spaceId: SPACE_ID, name: 'E2E 테스트채널' },
      })

      // ProductListing — channelStock=10 으로 초기화
      const listing = await prisma.productListing.create({
        data: {
          spaceId: SPACE_ID,
          channelId: channel.id,
          searchName: 'E2E 테스트 상품',
          displayName: 'E2E 테스트 상품',
          channelStock: 10,
          status: 'ACTIVE',
        },
      })
      listingId = listing.id

      // DelBatch (MANUAL, DRAFT)
      const batch = await prisma.delBatch.create({
        data: { spaceId: SPACE_ID, source: 'MANUAL', status: 'DRAFT' },
      })
      batchId = batch.id

      // DelOrder (PII 필드는 더미 암호화값으로 채움)
      const order = await prisma.delOrder.create({
        data: {
          spaceId: SPACE_ID,
          batchId,
          orderDate: new Date('2026-01-01'),
          recipientNameEnc: 'dummyenc',
          recipientNameIv: 'dummyiv1',
          phoneEnc: 'dummyenc',
          phoneIv: 'dummyiv2',
          addressEnc: 'dummyenc',
          addressIv: 'dummyiv3',
        },
      })

      // DelOrderItem — quantity=3, listingId=위 listing
      await prisma.delOrderItem.create({
        data: {
          orderId: order.id,
          name: 'E2E 테스트 상품',
          quantity: 3,
          listingId,
        },
      })

      // resolveDeckContext mock — 모든 라우트 핸들러에서 space/user 반환
      ;(resolveDeckContext as jest.Mock).mockResolvedValue({
        space: { id: SPACE_ID, name: 'E2E ChStockRestore' },
        user: { id: USER_ID },
      })
    })

    afterAll(async () => {
      await cleanup()
      await prisma.$disconnect()
    })

    test('PATCH status=COMPLETED → 200, channelStock=7, ChannelStockMovement 1행', async () => {
      const res = (await PATCH(patchReq({ status: 'COMPLETED' }), {
        params: Promise.resolve({ batchId }),
      }))!
      expect(res.status).toBe(200)

      // channelStock: 10 - 3 = 7
      const listing = await prisma.productListing.findUnique({ where: { id: listingId } })
      expect(listing?.channelStock).toBe(7)

      // 원장 행 1개 생성
      const movements = await prisma.channelStockMovement.findMany({ where: { batchId } })
      expect(movements).toHaveLength(1)
      expect(movements[0].quantity).toBe(3)
    })

    test('DELETE batch → 200, channelStock=10 복원, ChannelStockMovement 0행, DelBatch 삭제됨', async () => {
      const res = (await DELETE(deleteReq(), {
        params: Promise.resolve({ batchId }),
      }))!
      expect(res.status).toBe(200)

      // channelStock 복원: 7 + 3 = 10
      const listing = await prisma.productListing.findUnique({ where: { id: listingId } })
      expect(listing?.channelStock).toBe(10)

      // 원장 행 cascade 삭제
      const movements = await prisma.channelStockMovement.findMany({ where: { batchId } })
      expect(movements).toHaveLength(0)

      // DelBatch 삭제됨
      const batch = await prisma.delBatch.findUnique({ where: { id: batchId } })
      expect(batch).toBeNull()
    })
  }
)

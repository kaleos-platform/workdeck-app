/**
 * PATCH /shipping/orders/[orderId]/items/[itemId]/match — option/listing 모드 stale fulfillment 삭제 e2e.
 *
 * 과거 manual 매칭으로 ChannelProductAliasFulfillment가 남아있을 때,
 * 새로 option/listing 모드로 매칭하면 stale fulfillment가 삭제되어야 한다.
 * 임포트 우선순위(fulfillments > listingId > optionId)상 stale 데이터가 남으면
 * 새 매칭이 무시되는 버그(감사 High #10)를 방지한다.
 *
 * throwaway space에 alias + fulfillment 시드. auth는 resolveDeckContext mock.
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
import { PATCH } from '../../../../app/api/sh/shipping/orders/[orderId]/items/[itemId]/match/route'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let orderId = ''
let itemId = ''
let optAId = ''
let optBId = ''
let aliasId = ''
let channelId = ''

async function cleanup() {
  await prisma.channelProductAliasFulfillment.deleteMany({
    where: { alias: { spaceId: SPACE_ID } },
  })
  await prisma.channelProductAlias.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.delOrderItemFulfillment.deleteMany({
    where: { orderItem: { order: { spaceId: SPACE_ID } } },
  })
  await prisma.delOrderItem.deleteMany({ where: { order: { spaceId: SPACE_ID } } })
  await prisma.delOrder.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.delBatch.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
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

d('PATCH match — option 모드 stale fulfillment 삭제 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E AliasFulfillment', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-alias-fulfillment@throwaway.test' },
    })

    // 채널 (spaceId + name 필수)
    const channel = await prisma.channel.create({
      data: { spaceId: SPACE_ID, name: 'E2E 테스트 채널' },
    })
    channelId = channel.id

    // 상품 계층: group → product → optionA, optionB
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 매칭상품', groupId: group.id, status: 'ACTIVE' },
    })
    optAId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'A' } }))
      .id
    optBId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'B' } }))
      .id

    // 배송 배치 → 주문 → 아이템
    const batch = await prisma.delBatch.create({ data: { spaceId: SPACE_ID } })
    const order = await prisma.delOrder.create({
      data: {
        spaceId: SPACE_ID,
        batchId: batch.id,
        channelId,
        orderDate: new Date('2026-01-01'),
        // PII 필드: 테스트용 더미값
        recipientNameEnc: 'enc',
        recipientNameIv: 'iv',
        phoneEnc: 'enc',
        phoneIv: 'iv',
        addressEnc: 'enc',
        addressIv: 'iv',
      },
    })
    orderId = order.id

    const item = await prisma.delOrderItem.create({
      data: { orderId, name: '테스트상품 세트', quantity: 1 },
    })
    itemId = item.id

    // alias: manual 매칭 흔적 — fulfillment(optionB, quantity=2)가 남아있는 상태
    // normalizeAlias('테스트상품 세트') = '테스트상품 세트' (이미 소문자+정규화)
    const alias = await prisma.channelProductAlias.create({
      data: {
        spaceId: SPACE_ID,
        channelId,
        aliasName: '테스트상품 세트',
        optionId: null,
        listingId: null,
        fulfillments: {
          create: [{ optionId: optBId, quantity: 2 }],
        },
      },
    })
    aliasId = alias.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E AliasFulfillment' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('option 모드 매칭 후 alias.optionId 업데이트 + stale fulfillment 삭제', async () => {
    const res = (await PATCH(patchReq({ mode: 'option', optionId: optAId, saveAlias: true }), {
      params: Promise.resolve({ orderId, itemId }),
    }))!

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('option')

    // alias가 optionA로 업데이트되었는지 확인
    const alias = await prisma.channelProductAlias.findUnique({ where: { id: aliasId } })
    expect(alias?.optionId).toBe(optAId)
    expect(alias?.listingId).toBeNull()

    // stale fulfillment(optionB)가 삭제되었는지 확인
    const fulfillments = await prisma.channelProductAliasFulfillment.findMany({
      where: { aliasId },
    })
    expect(fulfillments).toHaveLength(0)
  })
})

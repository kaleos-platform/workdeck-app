/**
 * PATCH /shipping/orders/[orderId] — channelId cross-space 인가 검증 e2e.
 *
 * 배송 주문 수정 시 body.channelId가 다른 Space 소속이면 400을 반환해야 한다(감사 Medium).
 * SPACE1 소속 DelOrder를 SPACE2 채널 ID로 수정 시도 → 400 + DB 불변 단언.
 * SPACE1 소속 채널 ID로 수정 시도 → 200 + DB 반영 단언.
 *
 * throwaway space(SPACE1, SPACE2)에 채널·배치·주문 시드. auth는 resolveDeckContext mock.
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
import { PATCH } from '../../../../app/api/sh/shipping/orders/[orderId]/route'

// 고유 throwaway UUID — 다른 e2e와 충돌 방지
const SPACE1_ID = 'e2e00000-0000-4000-8000-000000000ca1'
const SPACE2_ID = 'e2e00000-0000-4000-8000-000000000ca2'
const USER_ID = 'e2e00000-0000-4000-8000-000000000ca3'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let orderId = ''
let alienChannelId = '' // SPACE2 소속 채널 — cross-space 시도용
let ownChannelId = '' // SPACE1 소속 채널

async function cleanup() {
  await prisma.delOrderItem.deleteMany({ where: { order: { spaceId: SPACE1_ID } } })
  await prisma.delOrder.deleteMany({ where: { spaceId: SPACE1_ID } })
  await prisma.delBatch.deleteMany({ where: { spaceId: SPACE1_ID } })
  await prisma.channel.deleteMany({ where: { spaceId: { in: [SPACE1_ID, SPACE2_ID] } } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: { in: [SPACE1_ID, SPACE2_ID] } } })
}

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

d('PATCH /shipping/orders/[orderId] — channelId cross-space 인가 검증 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    // SPACE1 — 테스트 주체 space
    await prisma.space.create({ data: { id: SPACE1_ID, name: 'E2E ChanAuthz Space1', type: 'PERSONAL' } })
    // SPACE2 — alien 채널 출처
    await prisma.space.create({ data: { id: SPACE2_ID, name: 'E2E ChanAuthz Space2', type: 'PERSONAL' } })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-chan-authz@throwaway.test' } })

    // SPACE2 소속 채널 — SPACE1 사용자가 접근 불가
    const alienChannel = await prisma.channel.create({
      data: { spaceId: SPACE2_ID, name: 'E2E Alien Channel' },
    })
    alienChannelId = alienChannel.id

    // SPACE1 소속 채널 — 정상 소유 채널
    const ownChannel = await prisma.channel.create({
      data: { spaceId: SPACE1_ID, name: 'E2E Own Channel' },
    })
    ownChannelId = ownChannel.id

    // SPACE1 배치 + 주문 시드 (PII enc/iv 더미값)
    const batch = await prisma.delBatch.create({ data: { spaceId: SPACE1_ID } })
    const order = await prisma.delOrder.create({
      data: {
        spaceId: SPACE1_ID,
        batchId: batch.id,
        orderDate: new Date('2026-01-01'),
        recipientNameEnc: 'enc',
        recipientNameIv: 'iv',
        phoneEnc: 'enc',
        phoneIv: 'iv',
        addressEnc: 'enc',
        addressIv: 'iv',
      },
    })
    orderId = order.id

    // resolveDeckContext를 SPACE1로 고정
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE1_ID, name: 'E2E ChanAuthz Space1' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('A: 타 space 채널 ID로 수정 시도 → 400, channelId 불변', async () => {
    const res = (await PATCH(patchReq({ channelId: alienChannelId }), {
      params: Promise.resolve({ orderId }),
    }))!

    expect(res.status).toBe(400)

    // DB에서 channelId가 변경되지 않았는지 확인
    const order = await prisma.delOrder.findUnique({ where: { id: orderId } })
    expect(order?.channelId).toBeNull()
  })

  test('B: 자 space 채널 ID로 수정 시도 → 200, channelId 반영', async () => {
    const res = (await PATCH(patchReq({ channelId: ownChannelId }), {
      params: Promise.resolve({ orderId }),
    }))!

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // DB에서 channelId가 정상 반영되었는지 확인
    const order = await prisma.delOrder.findUnique({ where: { id: orderId } })
    expect(order?.channelId).toBe(ownChannelId)
  })
})

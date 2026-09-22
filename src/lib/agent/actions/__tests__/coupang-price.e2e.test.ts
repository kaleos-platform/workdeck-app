/**
 * seller-hub.coupang-price.change 액션 e2e — 실 dev DB.
 * 실행 전제: .env.local(dev DB). 없으면 describe.skip.
 *
 * 검증: 승인 시 CoupangWriteJob(PRICE_CHANGE) 생성(쿠팡 직접 호출 없음),
 *       6시간 만료, VAT 미포함 거부, 쿠팡 워크스페이스 미연결 거부.
 */
// @jest-environment node
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000b1'
const UNLINKED_SPACE_ID = 'e2e00000-0000-4000-8000-0000000000b2'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000b3'
const WORKSPACE_ID = 'e2e00000-0000-4000-8000-0000000000b4'
const CHANNEL_ID = 'e2e00000-0000-4000-8000-0000000000b5'
const LOCATION_ID = 'e2e00000-0000-4000-8000-0000000000b6'
const LISTING_ID = 'e2e00000-0000-4000-8000-0000000000b7'

const validParams = {
  channelAxis: 'RG' as const,
  channelId: CHANNEL_ID,
  apActive: true,
  targets: [
    {
      listingId: LISTING_ID,
      vendorItemId: '96037831212',
      listingName: '테스트 리스팅',
      currentPrice: 65790,
      targetPrice: 66000,
      apMinSalePrice: 58200,
    },
  ],
  rationale: {
    costPrice: 30000,
    channelFeePct: 0.1,
    shippingCost: 3000,
    targetMargin: 0.25,
    computedMargin: 0.27,
    discountRate: 0,
    promotionLabel: null,
    includeVat: true,
    vatRate: 0.1,
  },
}

d('seller-hub.coupang-price.change', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-coupang-price@throwaway.test', name: 'E2E Coupang Price' },
    })
    // 쿠팡 자격 — Workspace는 User와 1:1(ownerId unique)이라 이 유저의 워크스페이스로 만든다.
    await prisma.workspace.upsert({
      where: { id: WORKSPACE_ID },
      update: {},
      create: { id: WORKSPACE_ID, name: 'E2E Coupang Workspace', ownerId: USER_ID },
    })

    // 연결된 space
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Coupang Price Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    await prisma.invStorageLocation.upsert({
      where: { id: LOCATION_ID },
      update: {},
      create: {
        id: LOCATION_ID,
        spaceId: SPACE_ID,
        name: 'E2E 로켓그로스 위치',
        externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
        externalIntegrationKey: WORKSPACE_ID,
      },
    })
    await prisma.channel.upsert({
      where: { id: CHANNEL_ID },
      update: {},
      create: { id: CHANNEL_ID, spaceId: SPACE_ID, name: 'E2E 로켓그로스 채널' },
    })
    await prisma.productListing.upsert({
      where: { id: LISTING_ID },
      update: {},
      create: {
        id: LISTING_ID,
        spaceId: SPACE_ID,
        channelId: CHANNEL_ID,
        searchName: 'E2E 테스트 리스팅',
        displayName: 'E2E 테스트 리스팅',
      },
    })
    await prisma.coupangProductItem.upsert({
      where: { listingId: LISTING_ID },
      update: {},
      create: {
        spaceId: SPACE_ID,
        sellerProductId: 'e2e-seller-product-1',
        rgVendorItemId: '96037831212',
        rgSalePrice: 65790,
        listingId: LISTING_ID,
        collectedAt: new Date(),
      },
    })

    // 쿠팡 미연결 space
    await prisma.space.upsert({
      where: { id: UNLINKED_SPACE_ID },
      update: {},
      create: { id: UNLINKED_SPACE_ID, name: 'E2E 미연결 Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: UNLINKED_SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: UNLINKED_SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
  })

  afterEach(async () => {
    await prisma.coupangWriteJob.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.agentPendingAction.deleteMany({
      where: { spaceId: { in: [SPACE_ID, UNLINKED_SPACE_ID] } },
    })
  })

  afterAll(async () => {
    await prisma.coupangWriteJob.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.agentPendingAction.deleteMany({
      where: { spaceId: { in: [SPACE_ID, UNLINKED_SPACE_ID] } },
    })
    await prisma.coupangProductItem.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.productListing.deleteMany({ where: { id: LISTING_ID } })
    await prisma.channel.deleteMany({ where: { id: CHANNEL_ID } })
    await prisma.invStorageLocation.deleteMany({ where: { id: LOCATION_ID } })
    await prisma.spaceMember.deleteMany({
      where: { spaceId: { in: [SPACE_ID, UNLINKED_SPACE_ID] } },
    })
    await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, UNLINKED_SPACE_ID] } } })
    await prisma.workspace.deleteMany({ where: { id: WORKSPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('승인하면 CoupangWriteJob 이 생기고 쿠팡을 직접 호출하지 않는다', async () => {
    const draft = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'seller-hub.coupang-price.change',
      params: validParams,
      summary: '쿠팡 로켓그로스 판매가 반영 — 1건',
      source: 'WEB',
      requestedBy: USER_ID,
    })

    const action = await prisma.agentPendingAction.findUniqueOrThrow({
      where: { id: draft.actionId },
    })
    // 가격 액션은 6시간 만료
    const hours = (action.expiresAt.getTime() - action.createdAt.getTime()) / 3_600_000
    expect(Math.round(hours)).toBe(6)

    const res = await approveAndExecute(draft.actionId, USER_ID)
    expect(res.ok).toBe(true)

    const job = await prisma.coupangWriteJob.findUniqueOrThrow({
      where: { actionId: draft.actionId },
    })
    expect(job.kind).toBe('PRICE_CHANGE')
    expect(job.status).toBe('PENDING')
  })

  test('VAT 미포함 시나리오는 액션 생성이 거부된다', async () => {
    await expect(
      createPendingAction({
        spaceId: SPACE_ID,
        actionType: 'seller-hub.coupang-price.change',
        params: {
          ...validParams,
          rationale: { ...validParams.rationale, includeVat: false },
        },
        summary: 'x',
        source: 'WEB',
        requestedBy: USER_ID,
      })
    ).rejects.toThrow(/VAT/)
  })

  test('쿠팡 워크스페이스가 연결되지 않은 space 는 액션 생성이 거부된다', async () => {
    await expect(
      createPendingAction({
        spaceId: UNLINKED_SPACE_ID,
        actionType: 'seller-hub.coupang-price.change',
        params: validParams,
        summary: 'x',
        source: 'WEB',
        requestedBy: USER_ID,
      })
    ).rejects.toThrow(/쿠팡/)
  })
})

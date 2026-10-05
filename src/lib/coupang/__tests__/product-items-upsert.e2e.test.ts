/**
 * 쿠팡 상품 API 수집 적재 e2e — 실 dev DB.
 * 검증: 재수집 시 같은 rgVendorItemId 는 갱신되고, 사람이 확정한 listingId 매핑은
 *       절대 지워지지 않는다.
 */
// @jest-environment node
import { prisma } from '@/lib/prisma'
import { upsertCoupangProductItems } from '../product-items'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000b1'
const CHANNEL_ID = 'e2e00000-0000-4000-8000-0000000000b2'
const LISTING_ID = 'e2e00000-0000-4000-8000-0000000000b3'

d('upsertCoupangProductItems', () => {
  beforeAll(async () => {
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Coupang Product Sync Throwaway', type: 'PERSONAL' },
    })
    await prisma.channel.upsert({
      where: { id: CHANNEL_ID },
      update: {},
      create: { id: CHANNEL_ID, spaceId: SPACE_ID, name: 'E2E 채널' },
    })
    await prisma.productListing.upsert({
      where: { id: LISTING_ID },
      update: {},
      create: {
        id: LISTING_ID,
        spaceId: SPACE_ID,
        channelId: CHANNEL_ID,
        searchName: 'E2E 상품',
        displayName: 'E2E 상품',
      },
    })
  })

  afterAll(async () => {
    await prisma.coupangProductItem.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.productListing.deleteMany({ where: { id: LISTING_ID } })
    await prisma.channel.deleteMany({ where: { id: CHANNEL_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.$disconnect()
  })

  test('재수집 시 같은 rgVendorItemId 는 갱신되고 listingId 는 보존된다', async () => {
    const spaceId = SPACE_ID
    await upsertCoupangProductItems(spaceId, [
      {
        sellerProductId: '15310472532',
        itemName: '누드 3P 2XL',
        rgVendorItemId: '96037831212',
        rgSalePrice: 65790,
        mpVendorItemId: '95847019386',
        mpSalePrice: 67800,
        barcode: '8809903551648',
        skuInfo: { weight: 250 },
        statusName: '승인완료',
      },
    ])

    const listing = await prisma.productListing.findFirstOrThrow({ where: { spaceId } })
    await prisma.coupangProductItem.updateMany({
      where: { spaceId, rgVendorItemId: '96037831212' },
      data: { listingId: listing.id },
    })

    // 가격만 바뀐 재수집
    await upsertCoupangProductItems(spaceId, [
      {
        sellerProductId: '15310472532',
        itemName: '누드 3P 2XL',
        rgVendorItemId: '96037831212',
        rgSalePrice: 66000,
        mpVendorItemId: '95847019386',
        mpSalePrice: 67800,
        barcode: '8809903551648',
        skuInfo: { weight: 250 },
        statusName: '승인완료',
      },
    ])

    const rows = await prisma.coupangProductItem.findMany({ where: { spaceId } })
    expect(rows).toHaveLength(1) // 중복 생성되지 않는다
    expect(rows[0].rgSalePrice).toBe(66000)
    expect(rows[0].listingId).toBe(listing.id) // 사람이 확정한 매핑이 수집으로 지워지지 않는다
  })
})

/**
 * PATCH /api/sh/products/listings/channel-products/[id] — 상품명 전파(propagateNames) 배선 e2e.
 *
 * 배경: 전파 *계산*(listing-name-propagation.ts)은 단위 테스트로 덮여 있지만, 라우트 쪽 배선
 * (플래그 가드·mixed 400·트랜잭션 커밋)은 수동 QA로만 확인돼 있었다. 이 테스트는 라우트를
 * 직접 import 해 그 배선을 고정한다.
 *
 * 시드는 케이스마다 별도 ChannelProduct/상품/옵션을 만들어 서로 간섭하지 않게 한다.
 * throwaway space/user 고유 UUID. afterAll cascade 정리. DB URL 없으면 skip.
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
import { PATCH } from '../../../../app/api/sh/products/listings/channel-products/[id]/route'

// throwaway IDs — 다른 e2e와 충돌 없는 고유 hex 영역(fa/fb, 기존 파일들이 쓰는 대역 grep으로 확인)
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000fa'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000fb'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.keywordChangeLog.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.productListingItem.deleteMany({ where: { listing: { spaceId: SPACE_ID } } })
  await prisma.productListing.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channelProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channelTypeDef.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/sh/products/listings/channel-products/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

let channelId = ''
let groupId = ''

async function makeProduct(name: string, optionAttributes: unknown = null) {
  const prod = await prisma.invProduct.create({
    data: { spaceId: SPACE_ID, name, groupId, optionAttributes: optionAttributes ?? undefined },
  })
  return prod.id
}

async function makeOption(
  productId: string,
  name: string,
  attributeValues: Record<string, string> = {}
) {
  const opt = await prisma.invProductOption.create({
    data: { productId, name, attributeValues, deletedAt: null },
  })
  return opt.id
}

async function makeChannelProduct(baseSearchName: string, baseDisplayName: string | null = null) {
  const cp = await prisma.channelProduct.create({
    data: { spaceId: SPACE_ID, channelId, baseSearchName, baseDisplayName },
  })
  return cp.id
}

async function makeListing(
  channelProductId: string,
  optionId: string,
  fields: {
    searchName: string
    displayName: string
    managementName?: string | null
    internalCode?: string | null
    memo?: string | null
  }
) {
  const listing = await prisma.productListing.create({
    data: {
      spaceId: SPACE_ID,
      channelId,
      channelProductId,
      searchName: fields.searchName,
      displayName: fields.displayName,
      managementName: fields.managementName ?? null,
      internalCode: fields.internalCode ?? null,
      memo: fields.memo ?? null,
      items: { create: [{ optionId, quantity: 1, sortOrder: 0 }] },
    },
  })
  return listing.id
}

d('PATCH /channel-products/[id] — propagateNames 배선 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E CP Name Propagate', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-cp-propagate@throwaway.test' },
    })
    const typeDef = await prisma.channelTypeDef.create({
      data: { spaceId: SPACE_ID, name: 'B2C', isSalesChannel: true },
    })
    const channel = await prisma.channel.create({
      data: { spaceId: SPACE_ID, name: 'E2E 판매채널', channelTypeDefId: typeDef.id },
    })
    channelId = channel.id
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: 'E2E 그룹' },
    })
    groupId = group.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E CP Name Propagate' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('1) 플래그 없으면 baseSearchName만 바뀌고 자식 리스팅 이름은 그대로', async () => {
    const productId = await makeProduct('P1 상품')
    const optionId = await makeOption(productId, '기본')
    const cpId = await makeChannelProduct('기존이름 A')
    const listingId = await makeListing(cpId, optionId, {
      searchName: '기존이름 A',
      displayName: '기존이름 A',
    })

    const res = await PATCH(patchReq({ baseSearchName: '새이름 A' }), {
      params: Promise.resolve({ id: cpId }),
    })
    expect(res!.status).toBe(200)
    const body = await res!.json()
    expect(body.channelProduct.baseSearchName).toBe('새이름 A')

    const listing = await prisma.productListing.findUniqueOrThrow({ where: { id: listingId } })
    expect(listing.searchName).toBe('기존이름 A')
    expect(listing.displayName).toBe('기존이름 A')
  })

  test('2) 플래그 있으면 옵션 접미사를 보존한 채 각 자식에 전파된다', async () => {
    const attrs = [{ name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] }]
    const productId = await makeProduct('P2 상품', attrs)
    const optBlack = await makeOption(productId, '블랙', { 색상: '블랙' })
    const optWhite = await makeOption(productId, '화이트', { 색상: '화이트' })
    const cpId = await makeChannelProduct('구상품')
    const listingBlackId = await makeListing(cpId, optBlack, {
      searchName: '구상품 블랙',
      displayName: '구상품 블랙',
    })
    const listingWhiteId = await makeListing(cpId, optWhite, {
      searchName: '구상품 화이트',
      displayName: '구상품 화이트',
    })

    const res = await PATCH(patchReq({ baseSearchName: '신상품', propagateNames: true }), {
      params: Promise.resolve({ id: cpId }),
    })
    expect(res!.status).toBe(200)

    const listingBlack = await prisma.productListing.findUniqueOrThrow({
      where: { id: listingBlackId },
    })
    const listingWhite = await prisma.productListing.findUniqueOrThrow({
      where: { id: listingWhiteId },
    })
    expect(listingBlack.searchName).toBe('신상품 블랙')
    expect(listingBlack.displayName).toBe('신상품 블랙')
    expect(listingWhite.searchName).toBe('신상품 화이트')
    expect(listingWhite.displayName).toBe('신상품 화이트')
  })

  test('3) mixed CP + 플래그 → 400, CP·자식 모두 저장 전 상태 그대로', async () => {
    const productAId = await makeProduct('P3A 상품')
    const productBId = await makeProduct('P3B 상품')
    const optA = await makeOption(productAId, '기본')
    const optB = await makeOption(productBId, '기본')
    const cpId = await makeChannelProduct('혼합상품')
    const listingAId = await makeListing(cpId, optA, {
      searchName: '혼합상품 A',
      displayName: '혼합상품 A',
    })
    const listingBId = await makeListing(cpId, optB, {
      searchName: '혼합상품 B',
      displayName: '혼합상품 B',
    })

    const res = await PATCH(patchReq({ baseSearchName: '새이름', propagateNames: true }), {
      params: Promise.resolve({ id: cpId }),
    })
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.message).toBe('여러 상품이 섞인 채널 상품은 상품명을 일괄 변경할 수 없습니다')

    const cp = await prisma.channelProduct.findUniqueOrThrow({ where: { id: cpId } })
    expect(cp.baseSearchName).toBe('혼합상품')
    const listingA = await prisma.productListing.findUniqueOrThrow({ where: { id: listingAId } })
    const listingB = await prisma.productListing.findUniqueOrThrow({ where: { id: listingBId } })
    expect(listingA.searchName).toBe('혼합상품 A')
    expect(listingB.searchName).toBe('혼합상품 B')
  })

  test('4) old base는 cp.baseSearchName 컬럼이 아니라 자식에서 역산한 값이다', async () => {
    // attrs는 정의돼 있지만(buildSuffix가 '블랙'을 계산할 수 있음), 자식 리스팅의 실제 이름은
    // 그 접미사를 달고 있지 않다 — deriveBaseValues는 stripSuffix가 매칭 안 되므로 이름 전체를
    // base로 되돌린다. cp.baseSearchName 컬럼은 일부러 전혀 다른 문자열로 어긋나게 심는다.
    const attrs = [{ name: '색상', values: [{ value: '블랙' }] }]
    const productId = await makeProduct('P4 상품', attrs)
    const optionId = await makeOption(productId, '블랙', { 색상: '블랙' })
    const cpId = await makeChannelProduct('틀린값') // 컬럼 = 실제 자식 이름과 무관한 값
    const listingId = await makeListing(cpId, optionId, {
      searchName: '진짜상품이름',
      displayName: '진짜상품이름',
    })

    const res = await PATCH(patchReq({ baseSearchName: '새상품', propagateNames: true }), {
      params: Promise.resolve({ id: cpId }),
    })
    expect(res!.status).toBe(200)

    const listing = await prisma.productListing.findUniqueOrThrow({ where: { id: listingId } })
    // 컬럼 '틀린값' 기준이면 name.startsWith('틀린값')가 false라 buildSuffix 폴백으로 빠져
    // '새상품 블랙'이 나온다(원래 이름에 없던 접미사를 지어 붙임). 자식 역산 기준이면
    // oldBase==='진짜상품이름'이라 tail=''이고 결과는 '새상품' 그대로여야 한다.
    expect(listing.searchName).toBe('새상품')
    expect(listing.displayName).toBe('새상품')
  })

  test('5) managementName/internalCode/memo는 전파 대상이 아니다', async () => {
    const productId = await makeProduct('P5 상품')
    const optionId = await makeOption(productId, '기본')
    const cpId = await makeChannelProduct('관리상품')
    const listingId = await makeListing(cpId, optionId, {
      searchName: '관리상품',
      displayName: '관리상품',
      managementName: '내부관리명유지',
      internalCode: 'CODE123',
      memo: '메모유지',
    })

    const res = await PATCH(patchReq({ baseSearchName: '새관리상품', propagateNames: true }), {
      params: Promise.resolve({ id: cpId }),
    })
    expect(res!.status).toBe(200)

    const listing = await prisma.productListing.findUniqueOrThrow({ where: { id: listingId } })
    expect(listing.searchName).toBe('새관리상품')
    expect(listing.managementName).toBe('내부관리명유지')
    expect(listing.internalCode).toBe('CODE123')
    expect(listing.memo).toBe('메모유지')
  })

  test('6) KeywordChangeLog는 base 기준 1건만 생긴다(자식 수만큼 아님)', async () => {
    const attrs = [{ name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] }]
    const productId = await makeProduct('P6 상품', attrs)
    const optBlack = await makeOption(productId, '블랙', { 색상: '블랙' })
    const optWhite = await makeOption(productId, '화이트', { 색상: '화이트' })
    const cpId = await makeChannelProduct('로그상품')
    await makeListing(cpId, optBlack, { searchName: '로그상품 블랙', displayName: '로그상품 블랙' })
    await makeListing(cpId, optWhite, {
      searchName: '로그상품 화이트',
      displayName: '로그상품 화이트',
    })

    const res = await PATCH(
      patchReq({
        baseSearchName: '로그신상품',
        propagateNames: true,
        changeReason: 'SPEC_CHANGE',
      }),
      { params: Promise.resolve({ id: cpId }) }
    )
    expect(res!.status).toBe(200)

    const logs = await prisma.keywordChangeLog.findMany({
      where: { spaceId: SPACE_ID, productId },
    })
    expect(logs).toHaveLength(1)
    expect(logs[0].beforeName).toBe('로그상품')
    expect(logs[0].afterName).toBe('로그신상품')
  })
})

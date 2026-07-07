/**
 * GET /api/sh/products/listings?status=SOLD_OUT — SOLD_OUT 필터 페이지네이션 정확도 e2e.
 *
 * 배경(감사 Medium): SOLD_OUT은 파생 상태(DB에 직접 저장 안 됨 — effectiveStatus 런타임 계산).
 * 수정 전: DB skip/take 후 후처리 필터 → total이 전체 ACTIVE 수로 오집계.
 * 수정 후: ACTIVE 후보 전체 로드 → in-memory 필터·페이지네이션 → total=실제 sold-out 수.
 *
 * 시드: listing 3건(SO1·SO2 재고 0 → SOLD_OUT, OK1 재고 10 → ACTIVE).
 * pageSize=1로 요청해 total===2, 3페이지에 걸쳐 2건만 노출되는지 검증.
 *
 * throwaway space/user 고유 UUID. afterAll cascade 0-state 복원. DB URL 없으면 skip.
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
import { GET } from '../../../../app/api/sh/products/listings/route'

// throwaway IDs — 다른 e2e와 충돌 없는 고유 hex 영역
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let channelId = ''
let listingIdSO1 = ''
let listingIdSO2 = ''
let listingIdOK1 = ''

async function cleanup() {
  // 역방향 cascade 순서로 삭제
  await prisma.productListingItem.deleteMany({ where: { listing: { spaceId: SPACE_ID } } })
  await prisma.productListing.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channelTypeDef.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { option: { product: { spaceId: SPACE_ID } } } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function getReq(params: Record<string, string>) {
  const url = new URL('http://localhost/api/sh/products/listings')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

d('GET /listings?status=SOLD_OUT — in-memory 페이지네이션 정확도 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    // Space + User 생성
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E SoldOut Pagination', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-soldout-pagination@throwaway.test' },
    })

    // ChannelTypeDef(isSalesChannel=true) + Channel 생성
    const typeDef = await prisma.channelTypeDef.create({
      data: { spaceId: SPACE_ID, name: 'B2C', isSalesChannel: true },
    })
    const channel = await prisma.channel.create({
      data: { spaceId: SPACE_ID, name: 'E2E 판매채널', channelTypeDefId: typeDef.id },
    })
    channelId = channel.id

    // InvProduct/Option 3종 생성 (각 listing마다 별도 옵션)
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본 그룹' },
    })
    const makeProduct = async (name: string) => {
      const prod = await prisma.invProduct.create({
        data: { spaceId: SPACE_ID, name, groupId: group.id },
      })
      const opt = await prisma.invProductOption.create({
        data: { productId: prod.id, name: '기본' },
      })
      return { productId: prod.id, optionId: opt.id }
    }

    const p1 = await makeProduct('품절상품1')
    const p2 = await makeProduct('품절상품2')
    const p3 = await makeProduct('정상상품1')

    // p3만 재고 10 보유 (p1, p2는 InvStockLevel 없음 → availableStock=0 → SOLD_OUT)
    const location = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 창고' },
    })
    await prisma.invStockLevel.create({
      data: {
        spaceId: SPACE_ID,
        optionId: p3.optionId,
        locationId: location.id,
        quantity: 10,
      },
    })

    // ProductListing 3건 생성 (전부 status=ACTIVE, channelStock=null → availableStock 기준 판정)
    const makeListing = async (name: string, optionId: string) => {
      const listing = await prisma.productListing.create({
        data: {
          spaceId: SPACE_ID,
          channelId,
          searchName: name,
          displayName: name,
          status: 'ACTIVE',
          channelStock: null,
          items: {
            create: [{ optionId, quantity: 1, sortOrder: 0 }],
          },
        },
      })
      return listing.id
    }

    listingIdSO1 = await makeListing('품절-A', p1.optionId)
    listingIdSO2 = await makeListing('품절-B', p2.optionId)
    listingIdOK1 = await makeListing('정상-C', p3.optionId)

    // resolveDeckContext mock
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E SoldOut Pagination' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('total===2 (전체 listing 3 아님) — 수정 전이면 total=3으로 실패하는 red', async () => {
    const res = await GET(getReq({ status: 'SOLD_OUT', page: '1', pageSize: '1' }))
    expect(res).toBeDefined()
    const body = await res!.json()
    // total은 실제 sold-out 수여야 함 (OK1은 포함 안 됨)
    expect(body.total).toBe(2)
    expect(body.pageSize).toBe(1)
    expect(body.page).toBe(1)
  })

  test('page=1 → data 1건, effectiveStatus === SOLD_OUT', async () => {
    const res = await GET(getReq({ status: 'SOLD_OUT', page: '1', pageSize: '1' }))
    const body = await res!.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].effectiveStatus).toBe('SOLD_OUT')
  })

  test('page=2 → data 1건 (두 번째 sold-out)', async () => {
    const res = await GET(getReq({ status: 'SOLD_OUT', page: '2', pageSize: '1' }))
    const body = await res!.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].effectiveStatus).toBe('SOLD_OUT')
  })

  test('page=3 → data 0건 (sold-out 2건 소진)', async () => {
    const res = await GET(getReq({ status: 'SOLD_OUT', page: '3', pageSize: '1' }))
    const body = await res!.json()
    expect(body.data).toHaveLength(0)
    // total은 여전히 2 (페이지가 바뀌어도 불변)
    expect(body.total).toBe(2)
  })

  test('정상재고 listing(OK1)은 SOLD_OUT 결과에 포함되지 않음', async () => {
    const res = await GET(getReq({ status: 'SOLD_OUT', page: '1', pageSize: '10' }))
    const body = await res!.json()
    const ids: string[] = body.data.map((r: { id: string }) => r.id)
    expect(ids).not.toContain(listingIdOK1)
    expect(ids).toEqual(expect.arrayContaining([listingIdSO1, listingIdSO2]))
  })

  test('status=ACTIVE 경로는 기존 DB 페이지네이션 유지 — total이 ACTIVE 전체 수', async () => {
    const res = await GET(getReq({ status: 'ACTIVE', page: '1', pageSize: '10' }))
    const body = await res!.json()
    // ACTIVE listing 3건 모두 포함 (SOLD_OUT도 DB status='ACTIVE'이므로)
    expect(body.total).toBe(3)
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })
})

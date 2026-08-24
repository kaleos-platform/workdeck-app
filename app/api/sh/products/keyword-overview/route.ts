import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 상품 축 키워드 화면의 좌측 목록.
 * 판매채널 상품이 하나라도 있는 상품만 보여준다 — 채널에 안 나가는 상품은
 * 이 화면에서 할 일이 없다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const q = (searchParams.get('q') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 30)))

  const where: Prisma.InvProductWhereInput = {
    spaceId: resolved.space.id,
    status: 'ACTIVE',
    // 목록에 오르는 조건도 집계와 같은 채널 기준을 쓴다 — 판매채널이 아닌 곳에만
    // 걸린 상품이 "채널 0개"로 목록에 남으면 고를 이유가 없는 행이 된다.
    options: {
      some: {
        deletedAt: null,
        listingItems: {
          some: { listing: { channel: { channelTypeDef: { isSalesChannel: true } } } },
        },
      },
    },
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { internalName: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.invProduct.findMany({
      where,
      orderBy: [{ internalName: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        internalName: true,
        brand: { select: { name: true } },
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  const productIds = rows.map((p) => p.id)
  // 집계는 DB 쪽 GROUP BY 로 내린다 — 리스팅 행과 중첩 items 를 앱 메모리로
  // 끌어오면(구 구현) 리스팅이 수천 건인 space 에서 이 라우트가 먼저 무너진다.
  // target_listings: 이번 페이지 상품이 걸린 리스팅만 먼저 좁힌다(spaceId 포함) —
  //   이 필터를 CTE 밖에 두면 Postgres 가 안으로 밀어 넣어 줄 거라 기대할 수 없어서
  //   (그룹 키가 아닌 컬럼 조건) DB 가 여전히 ProductListingItem 전체를 훑는다.
  // listing_products: 위에서 좁힌 리스팅에 한해 (삭제 안 된) 옵션이 가리키는
  //   distinct productId 를 센다 — 혼합 세트 판정에는 그 리스팅의 옵션 전부가
  //   필요하므로 여기서는 productId 로 다시 거르지 않는다(거르면 혼합 세트가
  //   단일 상품으로 오판된다). product_count = 1 인 것만 "단일 상품 리스팅" —
  //   2개 이상이면 혼합 세트라 특정 상품 것이라 말할 수 없으므로 keyword-cards
  //   카드 생성 규칙과 맞춰 제외한다(한쪽만 바꾸면 좌측 "채널 N개" 와 우측
  //   카드 수가 어긋난다).
  // qualifying: 판매채널(isSalesChannel=true)에 걸린, 단일 상품 리스팅만 남기고
  //   그 상품이 이번 페이지 대상(productIds)일 때만 distinct channelId 를 센다.
  const counts =
    productIds.length === 0
      ? []
      : await prisma.$queryRaw<Array<{ productId: string; channelCount: bigint }>>`
          WITH target_listings AS (
            SELECT DISTINCT pli."listingId" AS "listingId"
            FROM "ProductListingItem" pli
            JOIN "InvProductOption" ipo ON ipo.id = pli."optionId"
            JOIN "ProductListing" pl0 ON pl0.id = pli."listingId"
            WHERE ipo."deletedAt" IS NULL
              AND pl0."spaceId" = ${resolved.space.id}
              AND ipo."productId" IN (${Prisma.join(productIds)})
          ),
          listing_products AS (
            SELECT
              pli."listingId" AS "listingId",
              COUNT(DISTINCT ipo."productId") AS product_count,
              MIN(ipo."productId") AS the_product_id
            FROM "ProductListingItem" pli
            JOIN "InvProductOption" ipo ON ipo.id = pli."optionId"
            WHERE ipo."deletedAt" IS NULL
              AND pli."listingId" IN (SELECT "listingId" FROM target_listings)
            GROUP BY pli."listingId"
          )
          SELECT
            lp.the_product_id AS "productId",
            COUNT(DISTINCT pl."channelId") AS "channelCount"
          FROM "ProductListing" pl
          JOIN listing_products lp ON lp."listingId" = pl.id
          JOIN "Channel" c ON c.id = pl."channelId"
          JOIN "ChannelTypeDef" ctd ON ctd.id = c."channelTypeDefId"
          WHERE pl."spaceId" = ${resolved.space.id}
            AND ctd."isSalesChannel" = true
            AND lp.product_count = 1
            AND lp.the_product_id IN (${Prisma.join(productIds)})
          GROUP BY lp.the_product_id
        `

  const channelCountByProduct = new Map(counts.map((c) => [c.productId, Number(c.channelCount)]))

  const data = rows.map((p) => ({
    id: p.id,
    name: p.internalName ?? p.name,
    brandName: p.brand?.name ?? null,
    channelCount: channelCountByProduct.get(p.id) ?? 0,
  }))

  return NextResponse.json({ data, total, page, pageSize })
}

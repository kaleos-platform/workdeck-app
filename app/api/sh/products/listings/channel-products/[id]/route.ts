import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productDisplayName } from '@/lib/sh/product-display'
import {
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingAvailableStockByLocation,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'
import { buildNamingWarnings } from '@/lib/sh/keyword-warnings'
import { diffKeywordChange, toKeywordList } from '@/lib/sh/keyword-change'
import { keywordChangeReasonFields } from '@/lib/sh/schemas'
import { absorbKeywords } from '@/lib/sh/keyword-absorb'

/**
 * 채널상품 단건 조회(GET) / 수정(PATCH) / 삭제(DELETE).
 */

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  baseSearchName: z.string().min(1).max(400).optional(),
  baseDisplayName: z.string().max(400).nullable().optional(),
  baseManagementName: z.string().max(400).nullable().optional(),
  baseInternalCode: z.string().max(100).nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
  keywords: z.array(z.string()).optional(),
  // §26 이력 기록용 — 저장 필드가 아니므로 update data 로 흘려보내면 안 된다(아래 구조분해).
  ...keywordChangeReasonFields,
})

// product 공통 메타 필드 (single: 해당 product, mixed: 첫 번째 product 기준 backward-compat)
type ProductMeta = {
  id: string
  name: string
  internalName: string | null
  displayName: string
  brand: { id: string; name: string } | null
  optionAttributes: Array<{ name: string; values: Array<{ value: string }> }>
  msrp: number | null
}
type SingleProduct = ProductMeta & { kind: 'single' }
type MixedProduct = ProductMeta & {
  kind: 'mixed'
  products: Array<{ id: string; name: string }>
}
type ProductUnion = SingleProduct | MixedProduct

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const cp = await prisma.channelProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      channel: {
        select: {
          id: true,
          name: true,
          channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
        },
      },
      listings: {
        orderBy: { createdAt: 'asc' },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: {
              option: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  retailPrice: true,
                  productId: true,
                  attributeValues: true,
                  product: {
                    select: {
                      id: true,
                      name: true,
                      internalName: true,
                      msrp: true,
                      optionAttributes: true,
                      brand: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!cp) return errorResponse('채널상품을 찾을 수 없습니다', 404)

  // 재고 배치 조회 — 옵션×위치별로 조회해 (1) 전체 합산(가용재고용) + (2) 위치별 분해 둘 다 구성
  const optionIds = Array.from(
    new Set(cp.listings.flatMap((l) => l.items.map((it) => it.optionId)))
  )
  const stockMap = new Map<string, number>() // optionId → 전체 위치 합산
  const stockByLoc = new Map<string, Map<string, number>>() // optionId → (locationId → qty)
  const locationIds = new Set<string>()
  if (optionIds.length > 0) {
    const rows = await prisma.invStockLevel.groupBy({
      by: ['optionId', 'locationId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of rows) {
      const qty = r._sum.quantity ?? 0
      stockMap.set(r.optionId, (stockMap.get(r.optionId) ?? 0) + qty)
      let byLoc = stockByLoc.get(r.optionId)
      if (!byLoc) {
        byLoc = new Map<string, number>()
        stockByLoc.set(r.optionId, byLoc)
      }
      byLoc.set(r.locationId, qty)
      locationIds.add(r.locationId)
    }
  }
  // 위치명 조회 (재고가 존재하는 위치만)
  const locationNameMap = new Map<string, string>()
  if (locationIds.size > 0) {
    const locs = await prisma.invStorageLocation.findMany({
      where: { spaceId: cp.spaceId, id: { in: Array.from(locationIds) } },
      select: { id: true, name: true },
    })
    for (const loc of locs) locationNameMap.set(loc.id, loc.name)
  }

  // product discriminated union 파생
  const allItems = cp.listings.flatMap((l) => l.items)
  const productIds = [...new Set(allItems.map((it) => it.option.productId))]

  let product: ProductUnion
  if (productIds.length <= 1) {
    // single product (또는 listing 없음)
    const repProduct = allItems[0]?.option.product
    const optionAttributes = Array.isArray(repProduct?.optionAttributes)
      ? (repProduct.optionAttributes as Array<{ name: string; values: Array<{ value: string }> }>)
      : []
    product = {
      kind: 'single',
      id: repProduct?.id ?? '',
      name: repProduct?.name ?? '',
      internalName: repProduct?.internalName ?? null,
      displayName: repProduct ? productDisplayName(repProduct) : '',
      brand: repProduct?.brand ?? null,
      optionAttributes,
      msrp: repProduct?.msrp != null ? Number(repProduct.msrp) : null,
    }
  } else {
    // mixed — backward-compat: id/name/displayName/optionAttributes/brand/msrp를 첫 번째 product 기준으로 채움
    const seenIds = new Set<string>()
    const mixedProducts: Array<{ id: string; name: string }> = []
    for (const it of allItems) {
      if (!seenIds.has(it.option.productId)) {
        seenIds.add(it.option.productId)
        mixedProducts.push({ id: it.option.productId, name: it.option.product?.name ?? '' })
      }
    }
    const repProduct = allItems[0]?.option.product
    const optionAttributes = Array.isArray(repProduct?.optionAttributes)
      ? (repProduct.optionAttributes as Array<{ name: string; values: Array<{ value: string }> }>)
      : []
    product = {
      kind: 'mixed',
      products: mixedProducts,
      // backward-compat fields
      id: repProduct?.id ?? '',
      name: repProduct?.name ?? '',
      internalName: repProduct?.internalName ?? null,
      displayName: repProduct ? productDisplayName(repProduct) : '',
      brand: repProduct?.brand ?? null,
      optionAttributes,
      msrp: repProduct?.msrp != null ? Number(repProduct.msrp) : null,
    }
  }

  const listings = cp.listings.map((l) => {
    // msrp: listing items에서 product msrp 추출 (첫 번째 옵션 기준)
    const firstProductMsrp = l.items[0]?.option.product?.msrp
    const productMsrp = firstProductMsrp != null ? Number(firstProductMsrp) : null

    const priceSnapshots = l.items.map((it) => ({
      quantity: it.quantity,
      retailPrice: it.option.retailPrice != null ? Number(it.option.retailPrice) : productMsrp,
    }))
    const stockSnapshots = l.items.map((it) => ({
      quantity: it.quantity,
      optionStock: stockMap.get(it.optionId) ?? 0,
    }))
    const baseline = computeListingRetailBaseline(priceSnapshots)
    const retailPrice = l.retailPrice != null ? Number(l.retailPrice) : null
    // 가용재고 = 물리 재고만으로 계산 (채널 재고 캡 없음)
    const available = computeListingAvailableStock(stockSnapshots)
    const effective = computeEffectiveStatus(l.status, available, l.channelStock)
    const { diff, percent } = computeDiscount(baseline, retailPrice)

    // 위치별 가용재고 분해 — 이 listing 구성에 등장하는 모든 위치
    const locIdsForListing = new Set<string>()
    for (const it of l.items) {
      const byLoc = stockByLoc.get(it.optionId)
      if (byLoc) for (const lid of byLoc.keys()) locIdsForListing.add(lid)
    }
    const availableByLocation = computeListingAvailableStockByLocation(
      Array.from(locIdsForListing).map((locId) => ({
        locationId: locId,
        items: l.items.map((it) => ({
          quantity: it.quantity,
          optionStock: stockByLoc.get(it.optionId)?.get(locId) ?? 0,
        })),
      }))
    )
      .map((row) => ({
        locationId: row.locationId,
        locationName: locationNameMap.get(row.locationId) ?? '(알 수 없는 위치)',
        availableStock: row.availableStock,
      }))
      .sort((a, b) => b.availableStock - a.availableStock)

    return {
      id: l.id,
      searchName: l.searchName,
      displayName: l.displayName,
      managementName: l.managementName,
      internalCode: l.internalCode,
      memo: l.memo,
      status: l.status,
      effectiveStatus: effective,
      retailPrice,
      channelStock: l.channelStock,
      baselinePrice: baseline,
      discountAmount: diff,
      discountPercent: percent,
      availableStock: available,
      autoAvailableStock: available,
      availableByLocation,
      items: l.items.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        sku: it.option.sku,
        quantity: it.quantity,
        attributeValues: (it.option.attributeValues ?? {}) as Record<string, string>,
      })),
      updatedAt: l.updatedAt.toISOString(),
    }
  })

  return NextResponse.json({
    channelProduct: {
      id: cp.id,
      baseSearchName: cp.baseSearchName,
      baseDisplayName: cp.baseDisplayName,
      baseManagementName: cp.baseManagementName,
      baseInternalCode: cp.baseInternalCode,
      memo: cp.memo,
      keywords: Array.isArray(cp.keywords) ? (cp.keywords as string[]) : [],
    },
    product,
    channel: {
      id: cp.channel.id,
      name: cp.channel.name,
      channelTypeDef: cp.channel.channelTypeDef,
    },
    listings,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const cp = await prisma.channelProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: {
      id: true,
      channelId: true, // 키워드 규칙 조회용
      // §26 이력의 "기존" 값 — 변경 여부를 판정하려면 패치 전 값이 필요하다.
      baseSearchName: true,
      keywords: true,
      // 이력 귀속 상품 추정용. 채널상품은 리스팅 여러 개를 묶고 각 리스팅이 여러 옵션을
      // 가질 수 있어 단일 상품으로 떨어지지 않을 수 있다(GET 의 kind:'mixed' 참조).
      // 삭제된 옵션은 제외 — listings/[listingId] 와 같은 귀속 오염을 막는다.
      listings: {
        select: {
          items: {
            where: { option: { deletedAt: null } },
            select: { option: { select: { productId: true } } },
          },
        },
      },
    },
  })
  if (!cp) return errorResponse('채널상품을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  // 사유 필드는 ChannelProduct 컬럼이 아니다 — 남은 필드만 update data 로 넘긴다.
  const { changeReason, reasonNote, observeMetric, ...updateData } = parsed.data

  // 저장 전에 400 판정을 끝낸다(값만 바뀌고 에러가 나가는 상태 방지).
  if (changeReason === 'OTHER' && !reasonNote?.trim()) {
    return errorResponse('기타 사유는 변경 사유 메모가 필요합니다', 400)
  }

  const nextSearchName = updateData.baseSearchName ?? cp.baseSearchName
  const nextKeywords = updateData.keywords ?? cp.keywords
  const changeDiff = diffKeywordChange({
    beforeName: cp.baseSearchName,
    afterName: nextSearchName,
    beforeKeywords: cp.keywords,
    afterKeywords: nextKeywords,
  })
  const shouldLogChange = Boolean(changeReason) && changeDiff.changed

  // 리스팅 구성 상품이 정확히 하나일 때만 productId 로 귀속한다. 여러 상품이 섞였거나
  // 리스팅이 없으면 대상 없이(둘 다 null) 남는다 — space 전체 목록에서만 보인다.
  const productIds = new Set(cp.listings.flatMap((l) => l.items.map((it) => it.option.productId)))
  const logProductId = productIds.size === 1 ? [...productIds][0] : null

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.channelProduct.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        baseSearchName: true,
        baseDisplayName: true,
        baseManagementName: true,
        baseInternalCode: true,
        memo: true,
        keywords: true,
        updatedAt: true,
      },
    })
    // 저장과 이력을 한 트랜잭션으로 묶는다 — 변경만 남고 기록이 빠지는 상태를 만들지 않는다.
    if (shouldLogChange && changeReason) {
      await tx.keywordChangeLog.create({
        data: {
          spaceId: resolved.space.id,
          productId: logProductId,
          beforeName: cp.baseSearchName,
          afterName: nextSearchName,
          beforeKeywords: toKeywordList(cp.keywords),
          afterKeywords: toKeywordList(nextKeywords),
          reason: changeReason,
          reasonNote: reasonNote ?? null,
          observeMetric: observeMetric ?? null,
          multiChange: changeDiff.multiChange,
          actorUserId: resolved.user.id,
        },
      })
    }
    return row
  })

  // R2: 채널상품 키워드는 정의상 상품 단위다. 자식 리스팅으로 팬아웃하지 않는다.
  await absorbKeywords({
    spaceId: resolved.space.id,
    keywords: nextKeywords,
    productId: logProductId,
    listingId: null,
  })

  // 저장 성공 이후 계산 — updated 가 곧 "패치 이후 유효값"이다.
  const namingWarnings = await buildNamingWarnings(resolved.space.id, cp.channelId, {
    searchName: updated.baseSearchName,
    displayName: updated.baseDisplayName,
    keywords: updated.keywords,
  })

  return NextResponse.json({
    channelProduct: updated,
    ...(namingWarnings ? { namingWarnings } : {}),
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const cp = await prisma.channelProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!cp) return errorResponse('채널상품을 찾을 수 없습니다', 404)

  // listings는 channelProductId FK가 SetNull이므로 채널상품 삭제 시 자동 해제됨
  await prisma.channelProduct.delete({ where: { id } })

  return new NextResponse(null, { status: 204 })
}

import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productListingPatchSchema } from '@/lib/sh/schemas'
import {
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'
import { productDisplayName } from '@/lib/sh/product-display'
import { buildNamingWarnings } from '@/lib/sh/keyword-warnings'
import { diffKeywordChange, toKeywordList } from '@/lib/sh/keyword-change'

type Params = { params: Promise<{ listingId: string }> }
const SALES_CHANNEL_ONLY_MESSAGE = '판매채널 상품은 판매채널 유형의 채널에만 등록할 수 있습니다'

function normalizeDisplayName(searchName: string, displayName?: string) {
  const trimmedSearchName = searchName.trim()
  const trimmedDisplayName = displayName?.trim() ?? ''
  return trimmedDisplayName || trimmedSearchName
}

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { listingId } = await params

  const listing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    include: {
      channelProduct: { select: { id: true } },
      channel: {
        select: {
          id: true,
          name: true,
          channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
        },
      },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          option: {
            select: {
              id: true,
              name: true,
              sku: true,
              retailPrice: true,
              costPrice: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  internalName: true,
                  msrp: true,
                  brand: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)

  const optionIds = listing.items.map((i) => i.optionId)
  const stockMap = new Map<string, number>()
  if (optionIds.length > 0) {
    const rows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of rows) stockMap.set(r.optionId, r._sum.quantity ?? 0)
  }

  const priceSnapshots = listing.items.map((it) => ({
    quantity: it.quantity,
    retailPrice:
      it.option.retailPrice != null
        ? Number(it.option.retailPrice)
        : it.option.product?.msrp != null
          ? Number(it.option.product.msrp)
          : null,
  }))
  const stockSnapshots = listing.items.map((it) => ({
    quantity: it.quantity,
    optionStock: stockMap.get(it.optionId) ?? 0,
  }))
  const baseline = computeListingRetailBaseline(priceSnapshots)
  const retailPrice = listing.retailPrice != null ? Number(listing.retailPrice) : null
  const available = computeListingAvailableStock(stockSnapshots)
  const effective = computeEffectiveStatus(listing.status, available, listing.channelStock)
  const { diff, percent } = computeDiscount(baseline, retailPrice)

  return NextResponse.json({
    listing: {
      id: listing.id,
      channelProductId: listing.channelProduct?.id ?? null,
      channel: listing.channel,
      internalCode: listing.internalCode,
      searchName: listing.searchName,
      displayName: listing.displayName,
      managementName: listing.managementName,
      keywords: Array.isArray(listing.keywords) ? listing.keywords : [],
      retailPrice,
      baselinePrice: baseline,
      discountAmount: diff,
      discountPercent: percent,
      status: listing.status,
      effectiveStatus: effective,
      availableStock: available,
      autoAvailableStock: available,
      channelStock: listing.channelStock,
      memo: listing.memo,
      items: listing.items.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        sku: it.option.sku,
        productId: it.option.product.id,
        productName: productDisplayName(it.option.product),
        productOfficialName: it.option.product.name,
        brandName: it.option.product.brand?.name ?? null,
        retailPrice:
          it.option.retailPrice != null
            ? Number(it.option.retailPrice)
            : it.option.product?.msrp != null
              ? Number(it.option.product.msrp)
              : null,
        costPrice: it.option.costPrice != null ? Number(it.option.costPrice) : null,
        quantity: it.quantity,
        sortOrder: it.sortOrder,
        optionStock: stockMap.get(it.optionId) ?? 0,
      })),
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { listingId } = await params

  const existing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    select: {
      id: true,
      channelId: true,
      channelProductId: true,
      searchName: true,
      managementName: true,
      keywords: true, // 부분 수정 시 "패치 이후 실제 값"으로 검증하기 위해 필요
      // §26 이력을 상품 단위로도 조회할 수 있게 귀속 상품을 추정하기 위한 최소 조회.
      items: { select: { option: { select: { productId: true } } } },
      channel: {
        select: { externalSource: true, channelTypeDef: { select: { isSalesChannel: true } } },
      },
    },
  })
  if (!existing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)
  if (existing.channel.channelTypeDef?.isSalesChannel !== true) {
    return errorResponse(SALES_CHANNEL_ONLY_MESSAGE, 400)
  }

  const body = await req.json().catch(() => ({}))
  const parsed = productListingPatchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 채널 자체 배송(연동) 채널은 채널 재고를 수동 수정할 수 없다 (연동 데이터로 자동 처리).
  if (input.channelStock !== undefined && existing.channel.externalSource != null) {
    return errorResponse('채널 자체 배송 채널은 채널 재고를 수동 수정할 수 없습니다', 400)
  }
  // §26 변경 이력. changeReason 이 없으면 이력만 남기지 않고 저장은 그대로 진행한다
  // (사유 강제는 UI 의 책임 — 여기서 막으면 이 라우트를 쓰는 기존 화면이 전부 깨진다).
  // 400 판정은 저장 전에 끝낸다 — 저장 후에 거절하면 값은 바뀐 채 에러만 돌아간다.
  if (input.changeReason === 'OTHER' && !input.reasonNote?.trim()) {
    return errorResponse('기타 사유는 변경 사유 메모가 필요합니다', 400)
  }

  const nextSearchName = input.searchName ?? existing.searchName
  const nextDisplayName =
    input.displayName === undefined
      ? undefined
      : normalizeDisplayName(nextSearchName, input.displayName)

  // items 변경 시 옵션 소속 검증. 이력 귀속 상품도 여기서 같이 파악한다(패치 이후 구성 기준).
  let nextProductIds = new Set(existing.items.map((it) => it.option.productId))
  if (input.items) {
    const optionIds = input.items.map((it) => it.optionId)
    const validOptions = await prisma.invProductOption.findMany({
      where: { id: { in: optionIds }, product: { spaceId: resolved.space.id, status: 'ACTIVE' } },
      select: { id: true, productId: true },
    })
    if (validOptions.length !== optionIds.length) {
      return errorResponse('일부 옵션을 찾을 수 없거나 미사용 상품에 속해 있습니다', 400)
    }
    nextProductIds = new Set(validOptions.map((o) => o.productId))
  }
  // 구성 상품이 정확히 하나일 때만 상품에 귀속한다. 여러 상품이 섞인 세트 리스팅은
  // 어느 상품의 이력이라 말할 수 없으므로 listingId 로만 남는다.
  const logProductId = nextProductIds.size === 1 ? [...nextProductIds][0] : null

  // 이력 대상 값은 "패치 이후 유효값" 기준이다(부분 수정이므로 요청 본문만으로는 알 수 없다).
  const nextKeywords = input.keywords ?? existing.keywords
  const changeDiff = diffKeywordChange({
    beforeName: existing.searchName,
    afterName: nextSearchName,
    beforeKeywords: existing.keywords,
    afterKeywords: nextKeywords,
  })
  // 사유가 있고 실제로 상품명·검색어가 바뀐 경우에만 기록한다(가격·재고만 바꾼 저장은 제외).
  const shouldLogChange = Boolean(input.changeReason) && changeDiff.changed

  await prisma.$transaction(async (tx) => {
    await tx.productListing.update({
      where: { id: listingId },
      data: {
        internalCode: input.internalCode === undefined ? undefined : input.internalCode,
        searchName: input.searchName ?? undefined,
        displayName: nextDisplayName,
        managementName: input.managementName === undefined ? undefined : input.managementName,
        keywords: input.keywords ?? undefined,
        retailPrice: input.retailPrice === undefined ? undefined : input.retailPrice,
        channelStock: input.channelStock === undefined ? undefined : input.channelStock,
        status: input.status ?? undefined,
        memo: input.memo === undefined ? undefined : input.memo,
      },
    })
    if (input.items) {
      await tx.productListingItem.deleteMany({ where: { listingId } })
      await tx.productListingItem.createMany({
        data: input.items.map((it, idx) => ({
          listingId,
          optionId: it.optionId,
          quantity: it.quantity,
          sortOrder: it.sortOrder ?? idx,
        })),
      })
    }
    // 같은 트랜잭션 안에서 남긴다 — 저장은 됐는데 이력만 빠지는 상태를 만들지 않는다.
    if (shouldLogChange && input.changeReason) {
      await tx.keywordChangeLog.create({
        data: {
          spaceId: resolved.space.id,
          listingId,
          productId: logProductId,
          beforeName: existing.searchName,
          afterName: nextSearchName,
          beforeKeywords: toKeywordList(existing.keywords),
          afterKeywords: toKeywordList(nextKeywords),
          reason: input.changeReason,
          reasonNote: input.reasonNote ?? null,
          observeMetric: input.observeMetric ?? null,
          multiChange: changeDiff.multiChange,
          actorUserId: resolved.user.id,
        },
      })
    }
  })

  // 저장 성공 이후 계산. 부분 수정이므로 요청 본문이 아니라 "패치 이후 유효값"을 검증한다.
  const namingWarnings = await buildNamingWarnings(resolved.space.id, existing.channelId, {
    searchName: nextSearchName,
    keywords: input.keywords ?? existing.keywords,
  })

  return NextResponse.json({
    listing: { id: listingId },
    ...(namingWarnings ? { namingWarnings } : {}),
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { listingId } = await params

  const listing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    select: { id: true, channelProductId: true },
  })
  if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)

  // FK Restrict(ProductionRunSet 등) 참조 시 P2003 — 연결 해제 전 삭제 불가
  try {
    await prisma.productListing.delete({ where: { id: listingId } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2003') {
      return errorResponse(
        '생산 차수 등에서 사용 중이라 삭제할 수 없습니다. 연결을 먼저 해제하세요',
        409
      )
    }
    throw e
  }

  if (listing.channelProductId) {
    const remaining = await prisma.productListing.count({
      where: { channelProductId: listing.channelProductId },
    })
    if (remaining === 0) {
      await prisma.channelProduct.delete({ where: { id: listing.channelProductId } })
    }
  }

  return NextResponse.json({ ok: true })
}

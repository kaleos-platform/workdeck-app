/**
 * SKU/옵션 단위 조회 — 재고·원가의 기준은 내부 InvProductOption 하나로 통합한다.
 * 판매채널(ProductListing)은 판매가(매출) 차이에만 관여하며 원가·재고를 중복 생성하지 않는다.
 *
 * 응답은 summary 와 rows 를 분리하고 페이지네이션한다(기본 응답 50KB 목표).
 * 스키마에 존재하지 않는 요청 필드는 null 로 채우지 않고 missingFields 에 명시한다.
 */

import { prisma } from '@/lib/prisma'
import { costExVat } from '@/lib/sh/cost'
import { lookupCategoryFeePct, DEFAULT_FEE_CATEGORY } from '@/lib/sh/channel-fee-lookup'

export interface QueryProductOptionsParams {
  productId?: string | null
  productIds?: string[] | null
  q?: string | null
  page?: number | null
  pageSize?: number | null
  /** 절대 오프셋. 지정 시 page 대신 사용한다(nextCursor 가 이 값을 돌려준다). */
  offset?: number | null
  includeInactive?: boolean
}

/** 기본 응답 바이트 예산. 초과하면 rows 를 잘라내고 nextCursor 로 이어받게 한다. */
const RESPONSE_BYTE_BUDGET = 50 * 1024

/** 옵션 속성 Json 의 한국어 키를 스펙의 영문 키로 정규화한다. 원본도 함께 보존. */
const ATTRIBUTE_KEY_MAP: Record<string, 'size' | 'color' | 'package' | 'type'> = {
  사이즈: 'size',
  크기: 'size',
  색상: 'color',
  컬러: 'color',
  구성: 'package',
  포장: 'package',
  세트: 'package',
  종류: 'type',
  타입: 'type',
}

function normalizeOptionValues(raw: unknown): {
  size: string | null
  color: string | null
  package: string | null
  type: string | null
  raw: Record<string, string>
} {
  const out = {
    size: null as string | null,
    color: null as string | null,
    package: null as string | null,
    type: null as string | null,
    raw: {} as Record<string, string>,
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null) continue
    const value = String(v)
    out.raw[k] = value
    const mapped = ATTRIBUTE_KEY_MAP[k.trim()]
    if (mapped && out[mapped] == null) out[mapped] = value
  }
  return out
}

/** 재고 상태 — 안전재고 기준 단순 판정(재고 현황 화면과 동일 의미). */
function stockStatus(qty: number, safety: number): 'OUT' | 'LOW' | 'NORMAL' {
  if (qty <= 0) return 'OUT'
  if (safety > 0 && qty < safety) return 'LOW'
  return 'NORMAL'
}

/**
 * InvProductOption 에 스키마상 존재하지 않는 요청 필드.
 * 값을 지어내지 않고 호출자에게 부재를 알린다.
 */
const SCHEMA_MISSING_FIELDS = [
  'barcode', // InvProductOption 에 컬럼 없음
  'salesChannels[].channelOptionId', // 채널사 발급 옵션ID 미저장 (내부 listingId 로 대체)
] as const

export async function queryProductOptions(spaceId: string, params: QueryProductOptionsParams = {}) {
  const page = Math.max(1, Math.floor(params.page ?? 1))
  // 기본 10 — 옵션 1건이 리스팅별 salesChannels 를 통째로 실어 약 3.5KB 나온다.
  // 50KB 예산(스펙)을 지키는 기본값이며, 더 필요하면 호출자가 pageSize 를 올린다.
  const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? 10)))
  const offset =
    params.offset != null && params.offset >= 0
      ? Math.floor(params.offset)
      : (page - 1) * pageSize
  const q = (params.q ?? '').trim().toLowerCase()

  const productIds = [
    ...(params.productId ? [params.productId] : []),
    ...(params.productIds ?? []),
  ]

  // 옵션 검색 조건 — q 는 상품명/관리명/옵션명/SKU 를 대상으로 한다.
  const where = {
    deletedAt: null,
    product: {
      spaceId,
      ...(productIds.length > 0 ? { id: { in: productIds } } : {}),
      ...(params.includeInactive ? {} : { status: 'ACTIVE' as const }),
    },
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { sku: { contains: q, mode: 'insensitive' as const } },
            { product: { name: { contains: q, mode: 'insensitive' as const } } },
            { product: { internalName: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const total = await prisma.invProductOption.count({ where })

  const options = await prisma.invProductOption.findMany({
    where,
    orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
    skip: offset,
    take: pageSize,
    select: {
      id: true,
      name: true,
      sku: true,
      costPrice: true,
      costVatIncluded: true,
      retailPrice: true,
      attributeValues: true,
      safetyStockQty: true,
      product: {
        select: { id: true, name: true, internalName: true, status: true },
      },
      stockLevels: { select: { quantity: true, location: { select: { name: true } } } },
      listingItems: {
        select: {
          listingId: true,
          quantity: true,
          listing: {
            select: {
              id: true,
              searchName: true,
              managementName: true,
              retailPrice: true,
              status: true,
              channelProductId: true,
              channelId: true,
              channel: {
                select: {
                  id: true,
                  name: true,
                  vatIncludedInFee: true,
                  feeRates: { select: { categoryName: true, ratePercent: true } },
                },
              },
              items: { select: { quantity: true } },
            },
          },
        },
      },
    },
  })

  const builtRows = options.map((o) => {
    const unitCost = costExVat(o.costPrice == null ? null : Number(o.costPrice), o.costVatIncluded)
    const currentQty = o.stockLevels.reduce((s, sl) => s + sl.quantity, 0)
    const safetyStock = o.safetyStockQty

    const salesChannels = o.listingItems
      .filter((li) => li.listing != null)
      .map((li) => {
        const l = li.listing
        // 리스팅 총 구성수량 — 세트면 2, 3 … 단가 환산 분모.
        const listingUnits = l.items.reduce((s, it) => s + Math.max(0, it.quantity), 0)
        const sellingPrice = l.retailPrice == null ? null : Number(l.retailPrice)
        const commissionRate = lookupCategoryFeePct(
          l.channel.feeRates.map((f) => ({
            categoryName: f.categoryName,
            ratePercent: Number(f.ratePercent),
          })),
          DEFAULT_FEE_CATEGORY
        )
        const feeAmount = sellingPrice == null ? null : sellingPrice * commissionRate

        return {
          channel: l.channel.name,
          channelId: l.channel.id,
          listingId: l.id,
          listingName: l.managementName ?? l.searchName,
          // 채널사 발급 상품ID가 아니라 내부 ChannelProduct.id 다.
          channelProductId: l.channelProductId,
          quantity: li.quantity,
          sellingPrice,
          unitSellingPrice:
            sellingPrice != null && listingUnits > 0 ? sellingPrice / listingUnits : null,
          // 별도 할인가 필드가 스키마에 없다 — 판매가와 동일 취급.
          salePrice: sellingPrice,
          commissionRate,
          feeAmount,
          vatIncludedInFee: l.channel.vatIncludedInFee,
          listingStatus: l.status,
        }
      })
      .sort((a, b) => a.channel.localeCompare(b.channel) || a.listingId.localeCompare(b.listingId))

    return {
      productId: o.product.id,
      productName: o.product.name,
      productInternalName: o.product.internalName,
      optionId: o.id,
      skuCode: o.sku,
      optionName: o.name,
      optionValues: normalizeOptionValues(o.attributeValues),
      status: stockStatus(currentQty, safetyStock),
      productStatus: o.product.status,
      currentQty,
      stockValue: unitCost * currentQty,
      unitCost,
      unitCostVatIncluded: o.costPrice == null ? null : Number(o.costPrice),
      retailPrice: o.retailPrice == null ? null : Number(o.retailPrice),
      safetyStock,
      stockByLocation: o.stockLevels.map((sl) => ({
        location: sl.location.name,
        quantity: sl.quantity,
      })),
      salesChannels,
    }
  })

  // 바이트 예산 초과 시 뒤에서부터 잘라낸다. 옵션당 채널 리스팅을 전부 싣기 때문에
  // 행 크기 편차가 커서 pageSize 만으로는 상한을 보장할 수 없다. 최소 1행은 남긴다.
  let rows = builtRows
  let truncatedForSize = false
  while (rows.length > 1 && Buffer.byteLength(JSON.stringify(rows), 'utf8') > RESPONSE_BYTE_BUDGET) {
    rows = rows.slice(0, -1)
    truncatedForSize = true
  }

  const summary = {
    total,
    page,
    pageSize,
    offset,
    truncatedForSize,
    returned: rows.length,
    optionCount: rows.length,
    totalQty: rows.reduce((s, r) => s + r.currentQty, 0),
    totalStockValue: rows.reduce((s, r) => s + r.stockValue, 0),
    outCount: rows.filter((r) => r.status === 'OUT').length,
    lowCount: rows.filter((r) => r.status === 'LOW').length,
    missingUnitCostCount: rows.filter((r) => r.unitCost === 0).length,
  }

  // 잘라낸 경우까지 정확하도록 커서는 "다음에 읽을 절대 오프셋"이다.
  const consumed = offset + rows.length
  const nextCursor = consumed < total ? String(consumed) : null

  return {
    summary,
    rows,
    page,
    pageSize,
    offset,
    total,
    nextCursor,
    missingFields: [...SCHEMA_MISSING_FIELDS],
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeAlias } from '@/lib/sh/product-matching'
import { nbaesongStoreKey } from '@/lib/inv/external-sources'
import { kstDay } from '@/lib/naver-commerce/nbaesong'
import { recomputeNbaesongOutbound } from '@/lib/naver-commerce/nbaesong-sync'
import { NAVER_COMMERCE_PROVIDER, type NaverCommerceConfig } from '@/lib/naver-commerce/client'

type Params = { params: Promise<{ orderId: string; itemId: string }> }

/**
 * PATCH /api/sh/shipping/orders/[orderId]/items/[itemId]/match
 * body:
 *   { mode: 'listing', listingId: string, saveAlias?: boolean }
 *   { mode: 'option',  optionId: string,  saveAlias?: boolean }
 *   { mode: 'manual',  fulfillments: [{ optionId, quantity }] }  // 카탈로그에 없는 복합 구성 수동 입력
 *   { mode: 'clear' }   // 매칭 해제 (별칭은 남김)
 *
 * 하위 호환: { optionId } 만 전달하면 'option' 모드로 처리.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { orderId, itemId } = await params

  const body = await req.json().catch(() => ({}))
  let mode: 'listing' | 'option' | 'manual' | 'clear' =
    typeof body?.mode === 'string' &&
    (body.mode === 'listing' ||
      body.mode === 'option' ||
      body.mode === 'manual' ||
      body.mode === 'clear')
      ? body.mode
      : 'option'
  const rawOptionId = body?.optionId
  const rawListingId = body?.listingId
  const rawSaveAlias = body?.saveAlias !== false // default true

  // 하위 호환: mode 없이 optionId만 온 경우
  if (!body?.mode) {
    mode = rawOptionId ? 'option' : 'clear'
  }

  const item = await prisma.delOrderItem.findFirst({
    where: { id: itemId, orderId },
    include: {
      order: {
        select: {
          id: true,
          spaceId: true,
          channelId: true,
          orderDate: true,
          batch: { select: { source: true } },
          channel: { select: { externalSource: true } },
        },
      },
    },
  })
  if (!item || item.order.spaceId !== resolved.space.id) {
    return errorResponse('주문 아이템을 찾을 수 없습니다', 404)
  }

  // N배송 자동 수집 주문: 시간별 재동기화가 DelOrder 를 지우고 다시 만들므로 매칭은 alias 로만 살아남는다.
  const isNbaesong = item.order.batch.source === 'NAVER_API'
  if (isNbaesong && mode === 'clear') {
    return errorResponse('N배송 자동 수집 주문은 매칭 해제할 수 없습니다', 400)
  }
  const saveAlias = isNbaesong || rawSaveAlias

  // N배송 단일 SKU 상품이 옵션 1개로 매칭되면: 바코드 alias(개당 → 그 옵션)를 남기고, 출고 수량을
  // 재동기화와 같은 값(수량 × 피킹 수량)으로 맞춘다. 세트 크기는 API 피킹 수량을 기준으로 삼는다.
  const sku =
    isNbaesong && Array.isArray(item.skuMappings) && item.skuMappings.length === 1
      ? (item.skuMappings[0] as { nsBarcode?: unknown; pickingQuantityPerOrder?: unknown })
      : null
  const applyNbaesongSingleOption = async (optionId: string) => {
    const nsBarcode = sku?.nsBarcode
    const picking = sku?.pickingQuantityPerOrder
    if (!item.order.channelId || typeof nsBarcode !== 'string' || !nsBarcode) return
    if (typeof picking !== 'number') return
    // 리졸버가 조회 키를 normalizeAlias 로 정규화하므로 저장도 같은 형태로 맞춘다.
    const bcAlias = normalizeAlias(`bc:${nsBarcode}`)
    await prisma.$transaction(async (tx) => {
      const alias = await tx.channelProductAlias.upsert({
        where: {
          channelId_aliasName: { channelId: item.order.channelId!, aliasName: bcAlias },
        },
        update: { optionId, listingId: null },
        create: {
          spaceId: resolved.space.id,
          channelId: item.order.channelId!,
          aliasName: bcAlias,
          optionId,
          listingId: null,
        },
      })
      await tx.channelProductAliasFulfillment.deleteMany({ where: { aliasId: alias.id } })
      await tx.delOrderItem.update({
        where: { id: itemId },
        data: { optionId: null, listingId: null },
      })
      await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
      await tx.delOrderItemFulfillment.createMany({
        data: [{ orderItemId: itemId, optionId, quantity: item.quantity * picking }],
      })
    })
  }

  // 매칭 변경 후 해당 일자 N배송 출고 재고를 다시 계산한다. 매칭은 이미 저장됐으므로 실패해도 요청은 성공 처리하고
  // (다음 시간별 동기화가 재계산) 로그만 남긴다.
  // 새 alias 가 지난 일자의 미매칭도 풀도록 스토어 커서를 null 로 되돌려 워커가 전 기간을 다시 동기화하게 한다.
  // ponytail: config read-modify-write — 동시 finish 가 커서를 덮어쓸 수 있음(다음 매칭 때 다시 초기화).
  const recomputeIfNbaesong = async () => {
    if (!isNbaesong || !item.order.channelId) return
    const storeKey = nbaesongStoreKey(item.order.channel?.externalSource ?? '')
    if (!storeKey) return
    try {
      const row = await prisma.spaceCredential.findUnique({
        where: {
          spaceId_provider: { spaceId: resolved.space.id, provider: NAVER_COMMERCE_PROVIDER },
        },
        select: { id: true, config: true },
      })
      const config = row?.config as NaverCommerceConfig | null | undefined
      if (!row || !config) return
      await prisma.spaceCredential.update({
        where: { id: row.id },
        data: {
          config: {
            ...config,
            stores: (config.stores ?? []).map((s) =>
              s.key === storeKey ? { ...s, backfilledThrough: null } : s
            ),
          },
        },
      })
      await recomputeNbaesongOutbound({
        spaceId: resolved.space.id,
        storeKey,
        channelId: item.order.channelId,
        locationId: config.locationId,
        dayKst: kstDay(item.order.orderDate.toISOString()),
      })
    } catch (err) {
      console.error('[match] N배송 출고 재계산 실패', err)
    }
  }

  if (mode === 'listing') {
    const listingId =
      typeof rawListingId === 'string' && rawListingId.trim() !== '' ? rawListingId : null
    if (!listingId) return errorResponse('listingId가 필요합니다', 400)

    const listing = await prisma.productListing.findFirst({
      where: { id: listingId, spaceId: resolved.space.id },
      include: {
        items: { select: { optionId: true, quantity: true } },
        channel: { select: { id: true } },
      },
    })
    if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 400)

    // orderItem 수량 × 구성 수량으로 fulfillments 생성
    const qty = item.quantity
    await prisma.$transaction(async (tx) => {
      await tx.delOrderItem.update({
        where: { id: itemId },
        data: { optionId: null, listingId },
      })
      await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
      if (listing.items.length > 0) {
        await tx.delOrderItemFulfillment.createMany({
          data: listing.items.map((li) => ({
            orderItemId: itemId,
            optionId: li.optionId,
            quantity: li.quantity * qty,
          })),
        })
      }
    })

    if (saveAlias && item.order.channelId) {
      const aliasName = normalizeAlias(item.name)
      if (aliasName) {
        // stale fulfillment가 남으면 임포트 우선순위(fulfillments 우선) 때문에
        // 새 listing 매칭이 무시되므로 alias 저장 시 반드시 기존 fulfillment를 삭제한다.
        await prisma.$transaction(async (tx) => {
          const alias = await tx.channelProductAlias.upsert({
            where: { channelId_aliasName: { channelId: item.order.channelId!, aliasName } },
            update: { listingId, optionId: null },
            create: {
              spaceId: resolved.space.id,
              channelId: item.order.channelId!,
              aliasName,
              listingId,
              optionId: null,
            },
          })
          await tx.channelProductAliasFulfillment.deleteMany({ where: { aliasId: alias.id } })
        })
      }
    }

    if (listing.items.length === 1) await applyNbaesongSingleOption(listing.items[0].optionId)
    await recomputeIfNbaesong()
    return NextResponse.json({
      ok: true,
      mode: 'listing',
      listingId,
      listing: {
        id: listing.id,
        searchName: listing.searchName,
        displayName: listing.displayName,
      },
      aliasSaved: saveAlias && !!item.order.channelId,
    })
  }

  if (mode === 'manual') {
    // 사용자가 입력하는 값은 "1 주문당" per-set 수량. 저장 시 orderItem.quantity를 곱해 총 출고 수량으로 스토어.
    // (listing 매칭과 동일한 의미론: fulfillment.quantity = perSet × orderItem.quantity)
    type ManualFulfillment = { optionId: string; perSetQuantity: number }
    const raw: unknown[] = Array.isArray(body?.fulfillments) ? body.fulfillments : []
    const list: ManualFulfillment[] = []
    for (const f of raw) {
      if (typeof f !== 'object' || !f) continue
      const optionId = (f as { optionId?: unknown }).optionId
      const quantity = Number((f as { quantity?: unknown }).quantity)
      if (typeof optionId !== 'string' || !optionId.trim()) continue
      if (!Number.isFinite(quantity) || quantity < 1) continue
      list.push({ optionId, perSetQuantity: Math.floor(quantity) })
    }
    if (list.length === 0) return errorResponse('출고 옵션을 1개 이상 입력해 주세요', 400)
    if (list.length > 50) return errorResponse('출고 옵션은 최대 50개까지 입력 가능합니다', 400)

    const optionIds: string[] = Array.from(new Set(list.map((f) => f.optionId)))
    const validOptions = await prisma.invProductOption.findMany({
      where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
      select: { id: true },
    })
    if (validOptions.length !== optionIds.length) {
      return errorResponse('유효하지 않은 옵션이 포함되어 있습니다', 400)
    }

    try {
      const orderQty = item.quantity
      await prisma.$transaction(async (tx) => {
        await tx.delOrderItem.update({
          where: { id: itemId },
          data: { optionId: null, listingId: null },
        })
        await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
        await tx.delOrderItemFulfillment.createMany({
          data: list.map((f) => ({
            orderItemId: itemId,
            optionId: f.optionId,
            quantity: f.perSetQuantity * orderQty,
          })),
        })
      })

      // alias 저장 (saveAlias=true + channelId 있을 때만)
      // 저장된 perSet 값 기준으로 alias fulfillments upsert → 다음 업로드 시 자동 매칭
      let savedAlias = false
      if (saveAlias && item.order.channelId) {
        const aliasName = normalizeAlias(item.name)
        if (aliasName) {
          await prisma.$transaction(async (tx) => {
            const alias = await tx.channelProductAlias.upsert({
              where: {
                channelId_aliasName: { channelId: item.order.channelId!, aliasName },
              },
              update: { listingId: null, optionId: null },
              create: {
                spaceId: resolved.space.id,
                channelId: item.order.channelId!,
                aliasName,
                listingId: null,
                optionId: null,
              },
            })
            await tx.channelProductAliasFulfillment.deleteMany({ where: { aliasId: alias.id } })
            await tx.channelProductAliasFulfillment.createMany({
              data: list.map((f) => ({
                aliasId: alias.id,
                optionId: f.optionId,
                quantity: f.perSetQuantity,
              })),
            })
          })
          savedAlias = true
        }
      }

      if (list.length === 1) await applyNbaesongSingleOption(list[0].optionId)
      await recomputeIfNbaesong()
      const totalQuantity = list.reduce((s, f) => s + f.perSetQuantity * orderQty, 0)
      return NextResponse.json({
        ok: true,
        mode: 'manual',
        fulfillmentCount: list.length,
        totalQuantity,
        savedAlias,
      })
    } catch (err) {
      console.error('[manual match] DB 에러', err)
      return errorResponse(
        err instanceof Error ? err.message : '수동 매칭 저장에 실패했습니다',
        500
      )
    }
  }

  if (mode === 'option') {
    const optionId =
      typeof rawOptionId === 'string' && rawOptionId.trim() !== '' ? rawOptionId : null
    if (!optionId) return errorResponse('optionId가 필요합니다', 400)

    const option = await prisma.invProductOption.findFirst({
      where: { id: optionId, product: { spaceId: resolved.space.id } },
      select: { id: true, name: true, product: { select: { id: true, name: true } } },
    })
    if (!option) return errorResponse('옵션을 찾을 수 없습니다', 400)

    await prisma.$transaction(async (tx) => {
      await tx.delOrderItem.update({
        where: { id: itemId },
        data: { optionId, listingId: null },
      })
      await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
    })

    if (saveAlias && item.order.channelId) {
      const aliasName = normalizeAlias(item.name)
      if (aliasName) {
        // stale fulfillment가 남으면 임포트 우선순위(fulfillments 우선) 때문에
        // 새 option 매칭이 무시되므로 alias 저장 시 반드시 기존 fulfillment를 삭제한다.
        await prisma.$transaction(async (tx) => {
          const alias = await tx.channelProductAlias.upsert({
            where: { channelId_aliasName: { channelId: item.order.channelId!, aliasName } },
            update: { optionId, listingId: null },
            create: {
              spaceId: resolved.space.id,
              channelId: item.order.channelId!,
              aliasName,
              optionId,
              listingId: null,
            },
          })
          await tx.channelProductAliasFulfillment.deleteMany({ where: { aliasId: alias.id } })
        })
      }
    }

    await applyNbaesongSingleOption(optionId)
    await recomputeIfNbaesong()
    return NextResponse.json({
      ok: true,
      mode: 'option',
      optionId,
      option: {
        id: option.id,
        name: option.name,
        product: option.product,
      },
      aliasSaved: saveAlias && !!item.order.channelId,
    })
  }

  // clear
  await prisma.$transaction(async (tx) => {
    await tx.delOrderItem.update({
      where: { id: itemId },
      data: { optionId: null, listingId: null },
    })
    await tx.delOrderItemFulfillment.deleteMany({ where: { orderItemId: itemId } })
  })
  return NextResponse.json({ ok: true, mode: 'clear' })
}

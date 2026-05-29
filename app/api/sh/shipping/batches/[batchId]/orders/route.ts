import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { decryptPii } from '@/lib/del/encryption'
import { maskName, maskPhone, maskAddress } from '@/lib/del/pii-masker'

type Params = { params: Promise<{ batchId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
  const pageSize = Math.min(
    100,
    Math.max(1, Number(req.nextUrl.searchParams.get('pageSize')) || 50)
  )
  const decrypt = req.nextUrl.searchParams.get('decrypt') === 'true'
  // 묶음 내 검색 — 주문번호·받는분·전화·주소·상품명 대상.
  // 받는분/전화/주소는 암호화 PII라 DB 검색 불가 → 전량 fetch 후 메모리 복호화-후-필터.
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const MIN_PHONE_DIGITS = 4
  const SEARCH_CAP = 500

  const where = { batchId, spaceId: resolved.space.id }

  const include = {
    items: {
      include: {
        option: {
          select: {
            id: true,
            name: true,
            product: { select: { id: true, name: true, internalName: true } },
          },
        },
        listing: {
          select: {
            id: true,
            searchName: true,
            displayName: true,
          },
        },
        fulfillments: {
          include: {
            option: {
              select: {
                id: true,
                name: true,
                product: { select: { id: true, name: true, internalName: true } },
              },
            },
          },
        },
      },
    },
    channel: { select: { id: true, name: true } },
    shippingMethod: { select: { id: true, name: true } },
  } as const

  type OrderWithRelations = Prisma.DelOrderGetPayload<{ include: typeof include }>
  let orders: OrderWithRelations[]
  let total: number

  if (q) {
    // 검색: 전량 fetch 후 복호화-후-필터 (페이지네이션 미적용)
    const all = await prisma.delOrder.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: SEARCH_CAP,
      include,
    })

    // 키 설정 오류(ENCRYPTION_KEY 미설정/길이)는 빈 결과로 숨기지 않고 500
    if (all.length > 0) {
      try {
        decryptPii(all[0].recipientNameEnc, all[0].recipientNameIv)
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        if (message.includes('ENCRYPTION_KEY') || message.includes('암호화 키')) {
          return errorResponse('검색 처리 중 오류가 발생했습니다', 500)
        }
      }
    }

    const qLower = q.toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const phoneSearchable = qDigits.length >= MIN_PHONE_DIGITS

    const filtered = all.filter((order) => {
      // 평문 매칭: 주문번호 + 상품명
      if (order.orderNumber?.toLowerCase().includes(qLower)) return true
      if (order.items.some((it) => it.name.toLowerCase().includes(qLower))) return true
      // 암호화 PII 매칭: 복호화 후 비교
      try {
        const name = decryptPii(order.recipientNameEnc, order.recipientNameIv)
        const addr = decryptPii(order.addressEnc, order.addressIv)
        if (name.toLowerCase().includes(qLower)) return true
        if (addr.toLowerCase().includes(qLower)) return true
        if (phoneSearchable) {
          const phoneVal = decryptPii(order.phoneEnc, order.phoneIv)
          if (phoneVal.replace(/\D/g, '').includes(qDigits)) return true
        }
      } catch {
        // row 복호화 실패 — PII 매칭만 제외, 위 평문 매칭은 이미 처리됨
      }
      return false
    })
    orders = filtered
    total = filtered.length
  } else {
    // 기본: 페이지네이션
    ;[orders, total] = await Promise.all([
      prisma.delOrder.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
      }),
      prisma.delOrder.count({ where }),
    ])
  }

  const data = orders.map((order) => {
    // DRAFT 배송 묶음이거나 명시적 복호화 요청 시에만 전체 데이터 반환
    const shouldDecrypt = batch.status === 'DRAFT' || decrypt
    let recipientName: string
    let phone: string
    let address: string

    try {
      const pii = decryptPii(order.recipientNameEnc, order.recipientNameIv)
      const phoneVal = decryptPii(order.phoneEnc, order.phoneIv)
      const addrVal = decryptPii(order.addressEnc, order.addressIv)

      if (shouldDecrypt) {
        recipientName = pii
        phone = phoneVal
        address = addrVal
      } else {
        recipientName = maskName(pii)
        phone = maskPhone(phoneVal)
        address = maskAddress(addrVal)
      }
    } catch {
      // 복호화 실패 시 안전한 플레이스홀더 반환
      recipientName = '[복호화 오류]'
      phone = '[복호화 오류]'
      address = '[복호화 오류]'
    }

    return {
      id: order.id,
      recipientName,
      phone,
      address,
      postalCode: order.postalCode,
      deliveryMessage: order.deliveryMessage,
      memo: order.memo,
      orderDate: order.orderDate,
      orderNumber: order.orderNumber,
      paymentAmount: order.paymentAmount,
      channel: order.channel,
      shippingMethod: order.shippingMethod,
      items: order.items.map((item) => {
        const opt = item.option
        const prod = opt?.product
        const productDisplay = prod
          ? prod.internalName && prod.internalName.trim().length > 0
            ? prod.internalName
            : prod.name
          : null
        return {
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          optionId: item.optionId,
          listingId: item.listingId,
          option: opt
            ? {
                id: opt.id,
                name: opt.name,
                product: prod
                  ? {
                      id: prod.id,
                      name: prod.name,
                      internalName: prod.internalName,
                      displayName: productDisplay,
                    }
                  : null,
              }
            : null,
          listing: item.listing
            ? {
                id: item.listing.id,
                searchName: item.listing.searchName,
                displayName: item.listing.displayName,
              }
            : null,
          fulfillments: item.fulfillments.map((f) => {
            const fprod = f.option.product
            const fdisplay =
              fprod.internalName && fprod.internalName.trim().length > 0
                ? fprod.internalName
                : fprod.name
            return {
              id: f.id,
              optionId: f.optionId,
              quantity: f.quantity,
              optionName: f.option.name,
              productId: fprod.id,
              productName: fdisplay,
            }
          }),
        }
      }),
      createdAt: order.createdAt,
    }
  })

  // 검색 시 전량 반환 — page 1 고정, pageSize는 전체 수
  return NextResponse.json({
    data,
    total,
    page: q ? 1 : page,
    pageSize: q ? total : pageSize,
  })
}

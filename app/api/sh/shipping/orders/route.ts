import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { encryptOrderPii, decryptPii } from '@/lib/del/encryption'
import { maskName, maskPhone, maskAddress } from '@/lib/del/pii-masker'
import { MAX_ITEMS_PER_ORDER } from '@/lib/sh/shipping-constants'

// 검색 입력 제약 — oracle 마찰 완화
const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 100
const MIN_PHONE_DIGITS = 4
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /api/sh/shipping/orders?q=<검색어>&limit=<n>
 *
 * 전체 데이터(묶음 무관, COMPLETED만)를 받는분·주문번호·전화·주소로 검색한다.
 * 받는분/전화/주소는 암호화 PII(row별 IV, 비결정적)라 DB 검색이 불가능하므로
 * COMPLETED 주문 전량을 fetch한 뒤 메모리에서 복호화-후-필터한다. (prod 79건 규모)
 * 결과는 항상 마스킹하며, 평문은 응답에 포함하지 않는다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const rawQ = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const q = rawQ.slice(0, MAX_QUERY_LENGTH)
  // 최소 검색 길이 미달 — 전체 덤프 방지
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ data: [], total: 0, hasMore: false })
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || DEFAULT_LIMIT)
  )

  const qLower = q.toLowerCase()
  const qDigits = q.replace(/\D/g, '')
  const phoneSearchable = qDigits.length >= MIN_PHONE_DIGITS

  // 후보 = 이 space의 COMPLETED 묶음 주문 전량 (필요 필드만 select — 데이터 최소화)
  // items는 압축 표시용 name/quantity만 — option/listing/fulfillments 매칭정보는 미포함.
  const candidates = await prisma.delOrder.findMany({
    where: { spaceId: resolved.space.id, batch: { status: 'COMPLETED' } },
    orderBy: { orderDate: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      paymentAmount: true,
      postalCode: true,
      deliveryMessage: true,
      memo: true,
      recipientNameEnc: true,
      recipientNameIv: true,
      phoneEnc: true,
      phoneIv: true,
      addressEnc: true,
      addressIv: true,
      channel: { select: { id: true, name: true } },
      shippingMethod: { select: { id: true, name: true } },
      items: { select: { name: true, quantity: true } },
    },
  })

  // 키 설정 오류(ENCRYPTION_KEY 미설정/길이 오류)는 빈 결과로 숨기지 않고 500.
  // decryptPii가 키 문제일 때 throw하는 것을 첫 후보에서 사전 검증한다.
  if (candidates.length > 0) {
    const first = candidates[0]
    try {
      decryptPii(first.recipientNameEnc, first.recipientNameIv)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      // ENCRYPTION_KEY 관련 오류면 운영 장애 → 500. (row 손상은 아래 루프에서 개별 처리)
      if (message.includes('ENCRYPTION_KEY') || message.includes('암호화 키')) {
        return errorResponse('검색 처리 중 오류가 발생했습니다', 500)
      }
    }
  }

  const matched: Array<{
    id: string
    recipientName: string
    phone: string
    address: string
    orderNumber: string | null
    orderDate: Date
    paymentAmount: unknown
    postalCode: string | null
    deliveryMessage: string | null
    memo: string | null
    channel: { id: string; name: string } | null
    shippingMethod: { id: string; name: string } | null
    items: Array<{ name: string; quantity: number }>
  }> = []

  for (const o of candidates) {
    let name = ''
    let phoneVal = ''
    let addr = ''
    let piiOk = true
    try {
      name = decryptPii(o.recipientNameEnc, o.recipientNameIv)
      phoneVal = decryptPii(o.phoneEnc, o.phoneIv)
      addr = decryptPii(o.addressEnc, o.addressIv)
    } catch {
      // 개별 row 복호화 실패(데이터 손상) — PII 매칭만 제외하고 orderNumber 매칭은 유지.
      piiOk = false
    }

    const orderNumberMatch = !!o.orderNumber && o.orderNumber.toLowerCase().includes(qLower)
    let piiMatch = false
    if (piiOk) {
      const phoneDigits = phoneVal.replace(/\D/g, '')
      piiMatch =
        name.toLowerCase().includes(qLower) ||
        addr.toLowerCase().includes(qLower) ||
        (phoneSearchable && phoneDigits.includes(qDigits))
    }

    if (!orderNumberMatch && !piiMatch) continue

    matched.push({
      id: o.id,
      // 결과는 항상 마스킹. 복호화 실패 row는 플레이스홀더.
      recipientName: piiOk ? maskName(name) : '[복호화 오류]',
      phone: piiOk ? maskPhone(phoneVal) : '[복호화 오류]',
      address: piiOk ? maskAddress(addr) : '[복호화 오류]',
      orderNumber: o.orderNumber,
      orderDate: o.orderDate,
      paymentAmount: o.paymentAmount,
      postalCode: o.postalCode,
      deliveryMessage: o.deliveryMessage,
      memo: o.memo,
      channel: o.channel,
      shippingMethod: o.shippingMethod,
      items: o.items,
    })
  }

  const total = matched.length
  const data = matched.slice(0, limit)

  return NextResponse.json({ data, total, hasMore: total > limit })
}

type OrderInput = {
  shippingMethodId?: string | null
  channelId?: string | null
  recipientName: string
  phone: string
  address: string
  postalCode?: string | null
  deliveryMessage?: string | null
  memo?: string | null
  orderDate: string
  orderNumber?: string | null
  paymentAmount?: number | null
  items?: { name: string; quantity: number; optionId?: string | null }[]
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const batchId = typeof body?.batchId === 'string' ? body.batchId : ''
  const ordersInput = Array.isArray(body?.orders) ? (body.orders as OrderInput[]) : []

  if (!batchId) return errorResponse('batchId가 필요합니다', 400)
  if (ordersInput.length === 0) return errorResponse('orders 배열이 필요합니다', 400)

  // 배송 묶음 확인
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }
  if (batch.status !== 'DRAFT') {
    return errorResponse('완료된 배송 묶음에는 주문을 추가할 수 없습니다', 400)
  }

  // 주문 일괄 생성 — 각 input index에 대해 성공이면 order, 실패면 null
  const resultByIndex: Array<{
    index: number
    id: string
    items: Array<{ id: string; name: string; quantity: number }>
  } | null> = new Array(ordersInput.length).fill(null)
  const errors: { index: number; message: string }[] = []

  for (let i = 0; i < ordersInput.length; i++) {
    const input = ordersInput[i]
    if (!input.recipientName || !input.phone || !input.address || !input.orderDate) {
      errors.push({
        index: i,
        message: '필수 필드가 누락되었습니다 (받는분, 전화, 주소, 주문일자)',
      })
      continue
    }

    const items = (input.items ?? []).slice(0, MAX_ITEMS_PER_ORDER)
    const encrypted = encryptOrderPii({
      recipientName: input.recipientName,
      phone: input.phone,
      address: input.address,
    })

    try {
      const order = await prisma.delOrder.create({
        data: {
          spaceId: resolved.space.id,
          batchId,
          shippingMethodId: input.shippingMethodId || null,
          channelId: input.channelId || null,
          ...encrypted,
          postalCode: input.postalCode || null,
          deliveryMessage: input.deliveryMessage || null,
          memo: input.memo || null,
          orderDate: new Date(input.orderDate),
          orderNumber: input.orderNumber || null,
          paymentAmount: input.paymentAmount != null ? input.paymentAmount : null,
          items: {
            create: items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              optionId: item.optionId ?? null,
            })),
          },
        },
        include: { items: true },
      })
      resultByIndex[i] = {
        index: i,
        id: order.id,
        items: order.items.map((it) => ({ id: it.id, name: it.name, quantity: it.quantity })),
      }
    } catch (err) {
      errors.push({ index: i, message: err instanceof Error ? err.message : '생성 실패' })
    }
  }

  const createdOrders = resultByIndex.filter(
    (
      v
    ): v is {
      index: number
      id: string
      items: Array<{ id: string; name: string; quantity: number }>
    } => v !== null
  )

  return NextResponse.json(
    {
      created: createdOrders.length,
      errors,
      orderIds: createdOrders.map((o) => o.id),
      // 각 성공 주문의 원본 input index + id + items — 클라이언트가 tempId → 실제 id 매핑 시 사용
      orders: createdOrders,
    },
    { status: 201 }
  )
}

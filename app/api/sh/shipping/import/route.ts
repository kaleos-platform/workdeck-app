import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseWithMapping, type ColumnMapping } from '@/lib/del/channel-import-parser'
import { encryptOrderPii } from '@/lib/del/encryption'
import { loadItemResolver } from '@/lib/del/resolve-order-items'
import { decryptXlsxBuffer, isEncryptedXlsx, WrongPasswordError } from '@/lib/sh/xlsx-encryption'

/**
 * 에러 메시지를 사용자 친화적인 한글로 변환
 */
function normalizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/Foreign key constraint/i.test(msg)) {
    return '배송방식 또는 판매채널 ID가 유효하지 않습니다'
  }
  if (/Invalid (?:Date|date value)/i.test(msg) || /RangeError.*time value/i.test(msg)) {
    return '주문일자 형식이 올바르지 않습니다 (YYYY-MM-DD)'
  }
  if (/ENCRYPTION_KEY|암호화 키|암호화/i.test(msg)) {
    return '서버 암호화 설정 오류 (관리자에게 문의)'
  }
  if (/Unique constraint/i.test(msg)) {
    return '중복된 주문 데이터입니다'
  }
  return msg
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const formData = await req.formData().catch(() => null)
  if (!formData) return errorResponse('FormData가 필요합니다', 400)

  const file = formData.get('file') as File | null
  const batchId = formData.get('batchId') as string | null
  const shippingMethodId = formData.get('shippingMethodId') as string | null
  const channelId = formData.get('channelId') as string | null
  const mappingJson = formData.get('columnMapping') as string | null

  if (!file) return errorResponse('파일이 필요합니다', 400)
  if (!batchId) return errorResponse('batchId가 필요합니다', 400)
  if (!channelId || channelId.trim() === '') return errorResponse('판매채널을 지정해 주세요', 400)
  if (!mappingJson) return errorResponse('columnMapping이 필요합니다', 400)

  // 배송 묶음 확인
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }
  if (batch.status !== 'DRAFT') {
    return errorResponse('완료된 배송 묶음에는 추가할 수 없습니다', 400)
  }

  let mapping: ColumnMapping
  try {
    mapping = JSON.parse(mappingJson)
  } catch {
    return errorResponse('columnMapping JSON이 유효하지 않습니다', 400)
  }

  let buffer = await file.arrayBuffer()
  const password = (formData.get('password') as string | null) ?? ''

  if (isEncryptedXlsx(buffer)) {
    if (!password) {
      return NextResponse.json(
        { error: '비밀번호로 보호된 파일입니다', code: 'ENCRYPTED_FILE_PASSWORD_REQUIRED' },
        { status: 422 }
      )
    }
    try {
      buffer = await decryptXlsxBuffer(buffer, password)
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        return NextResponse.json(
          { error: '비밀번호가 올바르지 않습니다', code: 'WRONG_PASSWORD' },
          { status: 422 }
        )
      }
      return errorResponse('암호화된 파일을 복호화하지 못했습니다', 400)
    }
  }

  let rows: import('@/lib/del/channel-import-parser').ParsedOrderRow[]
  let parseErrors: { row: number; message: string }[]
  try {
    const result = parseWithMapping(buffer, mapping)
    rows = result.rows
    parseErrors = result.errors
  } catch {
    return errorResponse(
      '파일 파싱 중 오류가 발생했습니다. 올바른 Excel/CSV 파일인지 확인해 주세요',
      400
    )
  }

  // 동일 주문(받는분·전화·주소·주문일자·주문번호) 행을 묶어 하나의 배송으로 등록
  // 묶인 행들의 상품은 items에 누적, 결제금액은 합산한다.
  type Group = {
    firstRowNum: number
    rows: import('@/lib/del/channel-import-parser').ParsedOrderRow[]
  }
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const key = [
      row.recipientName,
      row.phone,
      row.address,
      row.orderDate,
      row.orderNumber ?? '',
    ].join('\u0000')
    const existing = groups.get(key)
    if (existing) {
      existing.rows.push(row)
    } else {
      groups.set(key, { firstRowNum: row.sourceRowNumber, rows: [row] })
    }
  }

  // N배송 자동 수집으로 이미 들어온 주문(대표 채널 = 이 채널)은 엑셀로 다시 넣지 않는다 — 재고 이중 차감 방지.
  const orderNumbers = [...new Set(rows.map((r) => r.orderNumber).filter((n): n is string => !!n))]
  const autoCollected =
    orderNumbers.length > 0
      ? new Set(
          (
            await prisma.delOrder.findMany({
              where: {
                spaceId: resolved.space.id,
                orderNumber: { in: orderNumbers },
                batch: { source: 'NAVER_API' },
                channel: { representativeChannelId: channelId },
              },
              select: { orderNumber: true },
            })
          ).map((o) => o.orderNumber)
        )
      : new Set<string | null>()

  // 채널별 상품 별칭으로 자동 매칭 (별칭은 채널 스코프, 우선순위 fulfillments > listing > option)
  const resolveItem = await loadItemResolver(
    resolved.space.id,
    [channelId],
    Array.from(groups.values()).flatMap((g) => g.rows.map((r) => r.productName as string))
  )

  // 주문 생성
  let created = 0
  let matchedItemCount = 0
  const createErrors: { row: number; recipientName?: string; message: string }[] = [...parseErrors]

  for (const group of groups.values()) {
    const first = group.rows[0]
    const rowNum = group.firstRowNum

    if (first.orderNumber && autoCollected.has(first.orderNumber)) {
      createErrors.push({ row: rowNum, message: 'N배송 자동 수집 주문 — 건너뜀' })
      continue
    }

    try {
      const encrypted = encryptOrderPii({
        recipientName: first.recipientName,
        phone: first.phone,
        address: first.address,
      })

      const items = group.rows
        .filter((r) => r.productName)
        .map((r) => resolveItem(r.productName as string, r.productQuantity ?? 1))
      matchedItemCount += items.filter(
        (it) => it.optionId || it.listingId || it.fulfillments.length > 0
      ).length

      const hasPayment = group.rows.some((r) => r.paymentAmount != null)
      // paymentIsOrderTotal: 각 행에 동일한 "주문 총액"이 반복되는 채널 → 1회만 사용(max는 일부 행 공백에 강건).
      // 기본(false): 행별 금액을 합산.
      const paymentTotal = mapping.paymentIsOrderTotal
        ? Math.max(...group.rows.map((r) => r.paymentAmount ?? 0))
        : group.rows.reduce((sum, r) => sum + (r.paymentAmount ?? 0), 0)

      await prisma.$transaction(async (tx) => {
        const order = await tx.delOrder.create({
          data: {
            spaceId: resolved.space.id,
            batchId,
            shippingMethodId: shippingMethodId || null,
            channelId: channelId || null,
            ...encrypted,
            postalCode: first.postalCode || null,
            deliveryMessage: first.deliveryMessage || null,
            memo: first.memo || null,
            orderDate: new Date(first.orderDate),
            orderNumber: first.orderNumber || null,
            paymentAmount: hasPayment ? paymentTotal : null,
          },
        })
        for (const it of items) {
          const created = await tx.delOrderItem.create({
            data: {
              orderId: order.id,
              name: it.name,
              quantity: it.quantity,
              optionId: it.optionId,
              listingId: it.listingId,
            },
          })
          if (it.fulfillments.length > 0) {
            await tx.delOrderItemFulfillment.createMany({
              data: it.fulfillments.map((f) => ({
                orderItemId: created.id,
                optionId: f.optionId,
                quantity: f.quantity,
              })),
            })
          }
        }
      })
      created++
    } catch (err) {
      // 수취인명(PII)은 서버 로그에서 제외 — 행 번호로 위치 식별 가능
      console.error('[del/import]', { row: rowNum, error: err })
      createErrors.push({
        row: rowNum,
        recipientName: first.recipientName,
        message: normalizeError(err),
      })
    }
  }

  return NextResponse.json({
    totalRows: rows.length + parseErrors.length,
    created,
    matchedItemCount,
    errorCount: createErrors.length,
    errors: createErrors.slice(0, 50),
  })
}

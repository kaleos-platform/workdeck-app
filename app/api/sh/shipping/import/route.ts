import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseWithMapping, type ColumnMapping } from '@/lib/del/channel-import-parser'
import { encryptOrderPii } from '@/lib/del/encryption'
import { buildAliasLookup, normalizeAlias } from '@/lib/sh/product-matching'

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
  const resolved = await resolveDeckContext('seller-hub')
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

  const buffer = await file.arrayBuffer()

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
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2
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
      groups.set(key, { firstRowNum: rowNum, rows: [row] })
    }
  }

  // 채널별 상품 별칭 사전을 한 번에 조회해 자동 매칭에 사용한다.
  // channelId가 없으면 매칭 skip (별칭은 채널 스코프).
  let aliasLookup = new Map<string, string>()
  if (channelId) {
    const uniqueNames = new Set<string>()
    for (const group of groups.values()) {
      for (const r of group.rows) {
        if (r.productName) uniqueNames.add(normalizeAlias(r.productName as string))
      }
    }
    if (uniqueNames.size > 0) {
      const aliasRows = await prisma.channelProductAlias.findMany({
        where: { channelId, aliasName: { in: Array.from(uniqueNames) } },
        select: { aliasName: true, optionId: true },
      })
      aliasLookup = buildAliasLookup(aliasRows)
    }
  }

  // 주문 생성
  let created = 0
  let matchedItemCount = 0
  const createErrors: { row: number; recipientName?: string; message: string }[] = [...parseErrors]

  for (const group of groups.values()) {
    const first = group.rows[0]
    const rowNum = group.firstRowNum

    try {
      const encrypted = encryptOrderPii({
        recipientName: first.recipientName,
        phone: first.phone,
        address: first.address,
      })

      const items = group.rows
        .filter((r) => r.productName)
        .map((r) => {
          const rawName = r.productName as string
          const optionId = aliasLookup.get(normalizeAlias(rawName)) ?? null
          if (optionId) matchedItemCount++
          return {
            name: rawName,
            quantity: r.productQuantity ?? 1,
            optionId,
          }
        })

      const hasPayment = group.rows.some((r) => r.paymentAmount != null)
      const paymentSum = group.rows.reduce((sum, r) => sum + (r.paymentAmount ?? 0), 0)

      await prisma.delOrder.create({
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
          paymentAmount: hasPayment ? paymentSum : null,
          items: items.length > 0 ? { create: items } : undefined,
        },
      })
      created++
    } catch (err) {
      console.error('[del/import]', { row: rowNum, recipient: first.recipientName, error: err })
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

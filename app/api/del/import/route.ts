import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseWithMapping, type ColumnMapping } from '@/lib/del/channel-import-parser'
import { encryptOrderPii } from '@/lib/del/encryption'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
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
  if (!shippingMethodId) return errorResponse('shippingMethodId가 필요합니다', 400)
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
    return errorResponse('파일 파싱 중 오류가 발생했습니다. 올바른 Excel/CSV 파일인지 확인해 주세요', 400)
  }

  // 주문 생성
  let created = 0
  const createErrors: { row: number; message: string }[] = [...parseErrors]

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const encrypted = encryptOrderPii({
      recipientName: row.recipientName,
      phone: row.phone,
      address: row.address,
    })

    const items = row.productName
      ? [{ name: row.productName, quantity: row.productQuantity ?? 1 }]
      : []

    try {
      await prisma.delOrder.create({
        data: {
          spaceId: resolved.space.id,
          batchId,
          shippingMethodId,
          channelId: channelId || null,
          ...encrypted,
          postalCode: row.postalCode || null,
          deliveryMessage: row.deliveryMessage || null,
          memo: row.memo || null,
          orderDate: new Date(row.orderDate),
          orderNumber: row.orderNumber || null,
          paymentAmount: row.paymentAmount ?? null,
          items: items.length > 0 ? { create: items } : undefined,
        },
      })
      created++
    } catch (err) {
      createErrors.push({
        row: i + 2,
        message: err instanceof Error ? err.message : '생성 실패',
      })
    }
  }

  return NextResponse.json({
    totalRows: rows.length + parseErrors.length,
    created,
    errorCount: createErrors.length,
    errors: createErrors.slice(0, 50),
  })
}

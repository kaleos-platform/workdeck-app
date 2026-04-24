import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateDeliveryFile } from '@/lib/del/delivery-file-generator'
import type { DelFieldMapping, DelFormatColumn } from '@/lib/del/format-templates'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const batchId = typeof body?.batchId === 'string' ? body.batchId : ''
  const shippingMethodId = typeof body?.shippingMethodId === 'string' ? body.shippingMethodId : ''

  if (!batchId || !shippingMethodId) {
    return errorResponse('batchId와 shippingMethodId가 필요합니다', 400)
  }

  // 배송 묶음 확인
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  // 배송 방식 확인
  const method = await prisma.delShippingMethod.findUnique({
    where: { id: shippingMethodId },
    select: { spaceId: true, name: true, formatConfig: true, labelColumns: true },
  })
  if (!method || method.spaceId !== resolved.space.id) {
    return errorResponse('배송 방식을 찾을 수 없습니다', 404)
  }

  // 배송 라벨 컬럼으로 허용된 field만 override 적용 대상.
  // 과거 DB에 남아 있는 다른 키는 배송 파일에 반영하지 않는다.
  const allowedLabelKeys = new Set<DelFieldMapping>(
    (Array.isArray(method.labelColumns) ? method.labelColumns : []).filter(
      (v): v is DelFieldMapping => typeof v === 'string'
    )
  )

  // 해당 배송 묶음 + 배송방식의 주문 조회 — 매칭된 옵션 정보도 같이 로드
  const orders = await prisma.delOrder.findMany({
    where: {
      batchId,
      shippingMethodId,
      spaceId: resolved.space.id,
    },
    include: {
      items: {
        include: {
          option: {
            select: {
              id: true,
              name: true,
              product: { select: { name: true, internalName: true } },
            },
          },
        },
      },
      channel: { select: { name: true } },
    },
  })

  if (orders.length === 0) {
    return errorResponse('해당 배송 방식의 주문이 없습니다', 400)
  }

  // 배송 방식 × 옵션 오버라이드 일괄 조회 → Map
  const optionIds = Array.from(
    new Set(orders.flatMap((o) => o.items.map((i) => i.optionId).filter((v): v is string => !!v)))
  )
  const labelRows = optionIds.length
    ? await prisma.delShippingMethodLabel.findMany({
        where: { shippingMethodId, optionId: { in: optionIds } },
        select: { optionId: true, overrides: true },
      })
    : []
  const overridesByOption = new Map<string, Partial<Record<DelFieldMapping, string>>>()
  for (const row of labelRows) {
    const raw = (row.overrides as Partial<Record<DelFieldMapping, string>>) ?? {}
    // 현재 배송방식에 활성화된 라벨 컬럼만 적용.
    const filtered: Partial<Record<DelFieldMapping, string>> = {}
    for (const key of Object.keys(raw) as DelFieldMapping[]) {
      if (allowedLabelKeys.has(key)) filtered[key] = raw[key]
    }
    overridesByOption.set(row.optionId, filtered)
  }

  const ordersForGenerator = orders.map((o) => ({
    ...o,
    items: o.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      option: i.option
        ? {
            name: i.option.name,
            product: {
              name: i.option.product.name, // 공식명
              internalName: i.option.product.internalName, // 관리명
            },
          }
        : null,
      overrides: i.optionId ? (overridesByOption.get(i.optionId) ?? null) : null,
    })),
  }))

  const formatConfig = method.formatConfig as DelFormatColumn[]
  const buffer = generateDeliveryFile(ordersForGenerator, formatConfig)

  const filename = encodeURIComponent(`${method.name}_배송파일.xlsx`)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

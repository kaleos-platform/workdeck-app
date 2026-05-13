import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { buildDeliveryRows, generateDeliveryFile } from '@/lib/del/delivery-file-generator'
import type { DelFieldMapping, DelFormatColumn } from '@/lib/del/format-templates'

/**
 * POST /api/sh/shipping/generate-file/bundle
 *
 * 배치 안의 주문을 shippingMethodId 별로 그룹핑하여 방식별 1 파일을 생성한다.
 * 각 방식의 `defaultSplitMode` 를 사용한다 (사용자가 splitMode 를 고르지 않는다).
 *
 * body: { batchId: string, preview?: boolean }
 *
 * preview=true:
 *   {
 *     methods: Array<{
 *       shippingMethodId, methodName, totalRows, splitMode,
 *       headers, columnFields, sampleRows  // sampleRows = 최대 5행
 *     }>,
 *     totalOrders, methodCount, splitMode: never (방식별로 다름)
 *   }
 *
 * preview=false:
 *   - 방식 1개: 단일 xlsx (Content-Type: application/vnd.openxmlformats-...)
 *   - 방식 2개+: ZIP (Content-Type: application/zip), 내부에 {methodName}.xlsx
 *
 * 주문 중 하나라도 shippingMethodId 가 null 이면 400.
 */

const PREVIEW_SAMPLE_LIMIT = 5

type SplitMode = 'order' | 'option'

/** generator 가 받는 형태 (delivery-file-generator 의 OrderWithItems 와 동치) */
type ItemLine = {
  name: string
  quantity: number
  option: {
    name: string
    product: { name: string; internalName: string | null }
  } | null
  overrides: Partial<Record<DelFieldMapping, string>> | null
}

type GeneratorOrder = {
  recipientNameEnc: string
  recipientNameIv: string
  phoneEnc: string
  phoneIv: string
  addressEnc: string
  addressIv: string
  postalCode: string | null
  deliveryMessage: string | null
  orderDate: Date
  orderNumber: string | null
  items: ItemLine[]
  channel: { name: string } | null
}

/** filename 에 쓸 수 없는 글자 제거 (Excel/ZIP 안전) */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'unnamed'
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const batchId = typeof body?.batchId === 'string' ? body.batchId : ''
  const preview = body?.preview === true

  if (!batchId) {
    return errorResponse('batchId가 필요합니다', 400)
  }

  // 배치 소유권 확인
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  // 배치 안의 모든 주문 (preview 여도 그룹 통계가 필요하므로 전체 조회)
  // 단 preview 일 때는 각 방식 sample 만 사용하므로 추후 슬라이스
  const orders = await prisma.delOrder.findMany({
    where: { batchId, spaceId: resolved.space.id },
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
          fulfillments: {
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
        },
      },
      channel: { select: { name: true } },
    },
  })

  if (orders.length === 0) {
    return errorResponse('배송 묶음에 주문이 없습니다', 400)
  }

  // 배송 방식 미지정 주문이 있으면 차단
  if (orders.some((o) => !o.shippingMethodId)) {
    return errorResponse('배송 방식이 지정되지 않은 주문이 있습니다', 400)
  }

  // 방식별 그룹핑
  const ordersByMethod = new Map<string, typeof orders>()
  for (const o of orders) {
    const key = o.shippingMethodId as string
    const arr = ordersByMethod.get(key)
    if (arr) arr.push(o)
    else ordersByMethod.set(key, [o])
  }

  const methodIds = Array.from(ordersByMethod.keys())

  // 모든 방식 한 번에 조회
  const methods = await prisma.delShippingMethod.findMany({
    where: { id: { in: methodIds }, spaceId: resolved.space.id },
    select: {
      id: true,
      name: true,
      formatConfig: true,
      labelColumns: true,
      defaultSplitMode: true,
    },
  })
  const methodById = new Map(methods.map((m) => [m.id, m]))
  if (methodIds.some((id) => !methodById.has(id))) {
    return errorResponse('일부 배송 방식을 찾을 수 없습니다', 404)
  }

  // option override 일괄 조회 (전 방식 합산)
  const allOptionIds = Array.from(
    new Set(
      orders.flatMap((o) =>
        o.items.flatMap((i) => {
          const ids: string[] = []
          if (i.optionId) ids.push(i.optionId)
          for (const f of i.fulfillments) ids.push(f.optionId)
          return ids
        })
      )
    )
  )
  const labelRows = allOptionIds.length
    ? await prisma.delShippingMethodLabel.findMany({
        where: { shippingMethodId: { in: methodIds }, optionId: { in: allOptionIds } },
        select: { shippingMethodId: true, optionId: true, overrides: true },
      })
    : []

  // shippingMethodId -> (optionId -> filtered overrides)
  const overridesByMethod = new Map<string, Map<string, Partial<Record<DelFieldMapping, string>>>>()
  for (const m of methods) {
    const allowed = new Set<DelFieldMapping>(
      (Array.isArray(m.labelColumns) ? m.labelColumns : []).filter(
        (v): v is DelFieldMapping => typeof v === 'string'
      )
    )
    const map = new Map<string, Partial<Record<DelFieldMapping, string>>>()
    for (const row of labelRows.filter((r) => r.shippingMethodId === m.id)) {
      const raw = (row.overrides as Partial<Record<DelFieldMapping, string>>) ?? {}
      const filtered: Partial<Record<DelFieldMapping, string>> = {}
      for (const key of Object.keys(raw) as DelFieldMapping[]) {
        if (allowed.has(key)) filtered[key] = raw[key]
      }
      map.set(row.optionId, filtered)
    }
    overridesByMethod.set(m.id, map)
  }

  /**
   * Prisma row 들을 generator 가 받는 형태로 변환한다.
   * fulfillments 가 있으면 각각을 별도 ItemLine 으로 펼친다 (listing 팬아웃).
   */
  function shapeForGenerator(
    raw: typeof orders,
    overrides: Map<string, Partial<Record<DelFieldMapping, string>>>
  ): GeneratorOrder[] {
    return raw.map((o) => ({
      recipientNameEnc: o.recipientNameEnc,
      recipientNameIv: o.recipientNameIv,
      phoneEnc: o.phoneEnc,
      phoneIv: o.phoneIv,
      addressEnc: o.addressEnc,
      addressIv: o.addressIv,
      postalCode: o.postalCode,
      deliveryMessage: o.deliveryMessage,
      orderDate: o.orderDate,
      orderNumber: o.orderNumber,
      channel: o.channel,
      items: o.items.flatMap((i) => {
        if (i.fulfillments.length > 0) {
          return i.fulfillments.map((f) => ({
            name: i.name,
            quantity: f.quantity,
            option: {
              name: f.option.name,
              product: {
                name: f.option.product.name,
                internalName: f.option.product.internalName,
              },
            },
            overrides: overrides.get(f.optionId) ?? null,
          }))
        }
        return [
          {
            name: i.name,
            quantity: i.quantity,
            option: i.option
              ? {
                  name: i.option.name,
                  product: {
                    name: i.option.product.name,
                    internalName: i.option.product.internalName,
                  },
                }
              : null,
            overrides: i.optionId ? (overrides.get(i.optionId) ?? null) : null,
          },
        ]
      }),
    }))
  }

  // === PREVIEW ===
  if (preview) {
    const methodsPayload = methodIds.map((mid) => {
      const m = methodById.get(mid)!
      const splitMode: SplitMode = m.defaultSplitMode === 'option' ? 'option' : 'order'
      const formatConfig = m.formatConfig as DelFormatColumn[]
      const groupOrders = ordersByMethod.get(mid)!
      const overrides = overridesByMethod.get(mid)!
      const shaped = shapeForGenerator(groupOrders, overrides)
      const { headers, rows } = buildDeliveryRows(shaped, formatConfig, { splitMode })
      return {
        shippingMethodId: mid,
        methodName: m.name,
        splitMode,
        totalOrders: groupOrders.length,
        totalRows: rows.length,
        headers,
        columnFields: formatConfig.map((col) => ({
          column: col.column,
          field: col.field ?? null,
        })),
        sampleRows: rows.slice(0, PREVIEW_SAMPLE_LIMIT),
      }
    })

    return NextResponse.json({
      methods: methodsPayload,
      totalOrders: orders.length,
      methodCount: methodIds.length,
    })
  }

  // === DOWNLOAD ===
  type GeneratedFile = { filename: string; buffer: Buffer; methodName: string }
  const generated: GeneratedFile[] = methodIds.map((mid) => {
    const m = methodById.get(mid)!
    const splitMode: SplitMode = m.defaultSplitMode === 'option' ? 'option' : 'order'
    const formatConfig = m.formatConfig as DelFormatColumn[]
    const groupOrders = ordersByMethod.get(mid)!
    const overrides = overridesByMethod.get(mid)!
    const shaped = shapeForGenerator(groupOrders, overrides)
    const buffer = generateDeliveryFile(shaped, formatConfig, { splitMode })
    return {
      filename: `${sanitizeFilename(m.name)}_배송파일.xlsx`,
      buffer,
      methodName: m.name,
    }
  })

  // 단일 방식 → xlsx 그대로 응답
  if (generated.length === 1) {
    const file = generated[0]
    const filename = encodeURIComponent(file.filename)
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // 2개+ → ZIP
  const zip = new JSZip()
  // 같은 방식명이 있을 경우 충돌 회피: 중복 시 suffix
  const usedNames = new Set<string>()
  for (const f of generated) {
    let name = f.filename
    let i = 2
    while (usedNames.has(name)) {
      name = f.filename.replace(/\.xlsx$/, `_${i}.xlsx`)
      i += 1
    }
    usedNames.add(name)
    zip.file(name, f.buffer)
  }
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const zipName = encodeURIComponent(`${batchId}_배송파일.zip`)
  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { processSetTransfer, MovementError } from '@/lib/inv/movement-processor'
import { decomposeSetsToOptions } from '@/lib/sh/set-plan-calc'

// 세트 조립·이관 — 자체창고에서 세트를 조립해 연동 위치(예: 쿠팡 로켓그로스)로 이관.
// 세트(listing) N개 = 구성옵션 setQty×perSet 만큼을 from→to 로 TRANSFER (단일 트랜잭션, all-or-nothing).
// 자체창고 수령 후 "재분류→FC" 경로의 본체. 조립 가능 세트 초과는 processSetTransfer 가 차단.
const schema = z.object({
  runId: z.string().optional(),
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  movementDate: z.string().optional(),
  transfers: z
    .array(
      z.object({
        listingId: z.string().min(1),
        setQty: z.number().int().positive(),
      })
    )
    .min(1)
    .max(200),
})

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { issues: parsed.error.issues })
  }
  const input = parsed.data

  if (input.fromLocationId === input.toLocationId) {
    return errorResponse('출발지와 도착지가 같을 수 없습니다', 400)
  }

  // 방향 가드 — 자체창고(externalSource=null) → 연동 위치(externalSource!=null) 만 허용.
  // processSetTransfer 의 재고 무결성 검사와 별개로, 이 엔드포인트의 용도(자체창고→FC 조립이관)를 서버에서 고정.
  const [fromLoc, toLoc] = await Promise.all([
    prisma.invStorageLocation.findFirst({
      where: { id: input.fromLocationId, spaceId: resolved.space.id },
      select: { id: true, name: true, externalSource: true },
    }),
    prisma.invStorageLocation.findFirst({
      where: { id: input.toLocationId, spaceId: resolved.space.id },
      select: { id: true, name: true, externalSource: true },
    }),
  ])
  if (!fromLoc) return errorResponse('출발 위치를 찾을 수 없습니다', 404)
  if (!toLoc) return errorResponse('도착 위치를 찾을 수 없습니다', 404)
  if (fromLoc.externalSource != null) {
    return errorResponse('출발지는 자체창고여야 합니다', 400)
  }
  if (toLoc.externalSource == null) {
    return errorResponse('도착지는 연동 위치여야 합니다', 400)
  }

  // 세트(listing) 로드 — space 소속 검증 + 구성옵션(BOM)
  const listingIds = Array.from(new Set(input.transfers.map((t) => t.listingId)))
  const listings = await prisma.productListing.findMany({
    where: { id: { in: listingIds }, spaceId: resolved.space.id },
    select: {
      id: true,
      items: { select: { optionId: true, quantity: true } },
    },
  })
  if (listings.length !== listingIds.length) {
    return errorResponse('일부 세트(listing)를 찾을 수 없습니다', 400)
  }
  const itemsByListing = new Map(listings.map((l) => [l.id, l.items]))

  // BOM 분해 — 세트수 × 구성수량 → 옵션별 총 이관량 (공유 옵션은 Σ 합산)
  const setInputs = input.transfers.map((t) => ({
    listingId: t.listingId,
    setQty: t.setQty,
    items: (itemsByListing.get(t.listingId) ?? []).map((it) => ({
      optionId: it.optionId,
      perSet: it.quantity,
    })),
  }))
  const optionDemand = decomposeSetsToOptions(setInputs)
  const components = Array.from(optionDemand, ([optionId, quantity]) => ({ optionId, quantity }))
  if (components.length === 0) {
    return errorResponse('이관할 구성옵션이 없습니다', 400)
  }

  const movementDate = input.movementDate ?? new Date().toISOString().slice(0, 10)
  // 차수·세트 단위 추적키 — 이후 위치별 이관 내역 집계용
  const referenceId = input.runId
    ? `setxfer:${input.runId}`
    : `setxfer:${listingIds.slice(0, 5).join(',')}`
  const setSummary = input.transfers
    .map((t) => `${t.setQty.toLocaleString('ko-KR')}세트`)
    .join(', ')
  const reason = `세트 조립·이관${input.runId ? ' · 차수연계' : ''} · ${setSummary} · 이관일 ${movementDate}`

  try {
    const result = await processSetTransfer(resolved.space.id, {
      components,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      movementDate,
      reason,
      referenceId,
    })
    return NextResponse.json({
      movements: result.movements.length,
      transferred: result.transferred,
    })
  } catch (e) {
    if (e instanceof MovementError) {
      return errorResponse(e.message, e.status)
    }
    throw e
  }
}

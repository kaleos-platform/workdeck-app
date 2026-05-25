import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { confirmReconciliation } from '@/lib/inv/reconciliation-processor'
import { MovementError } from '@/lib/inv/movement-processor'
import type { MatchEntry, FileOnlyEntry } from '@/lib/inv/reconciliation-matcher'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/sh/inventory/reconciliation/[id]
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const recon = await prisma.invReconciliation.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: { location: { select: { id: true, name: true } } },
  })
  if (!recon) return errorResponse('대조 기록을 찾을 수 없습니다', 404)

  // 이 대조에 이미 적용된 optionId 목록 (멀티 location 대응 — locationId 별로 distinct)
  const movements = await prisma.invMovement.findMany({
    where: { referenceId: id, type: 'ADJUSTMENT' },
    select: { optionId: true, locationId: true },
  })
  // 후방 호환: 기존 UI는 optionId 단일 set으로 비교. 멀티 location도 optionId만 노출.
  const appliedOptionIds = Array.from(new Set(movements.map((m) => m.optionId)))

  // matchResults 후처리: file-only 중 InvLocationProductMap에 매핑된 항목은
  // 현재 시스템 재고를 기준으로 matched-equal/matched-diff로 가상 변환 (N entries 분리)
  // 스냅샷 DB는 수정하지 않음. entry.locationId 우선, 없으면 recon.locationId fallback.
  const rawEntries = (recon.matchResults ?? []) as MatchEntry[]
  const resolved2 = await resolveFileOnlyEntries(rawEntries, recon.locationId)

  // matched-equal/matched-diff 항목에 mappingId + mapping.items 첨부
  const matchResults = await attachMappingInfo(resolved2, recon.locationId)

  return NextResponse.json({ reconciliation: { ...recon, matchResults, appliedOptionIds } })
}

/**
 * matched-equal/matched-diff 항목에 InvLocationProductMap.id(mappingId)와
 * mapping.items[]를 함께 내려준다.
 * - mappingId: UI의 [매칭 수정] PATCH가 필요
 * - mapping.items: UI에서 N개 항목의 옵션 정보 렌더링용
 */
async function attachMappingInfo(
  entries: (MatchEntry & { mappingId?: string; mappingItems?: unknown[] })[],
  reconLocationId: string
): Promise<(MatchEntry & { mappingId?: string; mappingItems?: unknown[] })[]> {
  // (locationId, externalCode) 페어 수집 — 멀티 location 대응
  const pairs: { locationId: string; externalCode: string }[] = []
  for (const e of entries) {
    if ((e.status === 'matched-equal' || e.status === 'matched-diff') && e.row?.externalCode) {
      const locId = (e as MatchEntry & { locationId?: string }).locationId ?? reconLocationId
      pairs.push({ locationId: locId, externalCode: e.row.externalCode })
    }
  }
  if (pairs.length === 0) return entries

  // location별로 묶어서 조회
  const codesByLoc = new Map<string, Set<string>>()
  for (const p of pairs) {
    const s = codesByLoc.get(p.locationId) ?? new Set()
    s.add(p.externalCode)
    codesByLoc.set(p.locationId, s)
  }

  type MappingInfo = {
    id: string
    items: {
      optionId: string
      quantity: number
      productName: string
      optionName: string
    }[]
  }
  const infoByKey = new Map<string, MappingInfo>() // `${locId}|${code}`

  for (const [locId, codeSet] of codesByLoc) {
    const mappings = await prisma.invLocationProductMap.findMany({
      where: { locationId: locId, externalCode: { in: Array.from(codeSet) } },
      select: {
        id: true,
        externalCode: true,
        items: {
          select: {
            optionId: true,
            quantity: true,
            option: {
              select: {
                name: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    })
    for (const m of mappings) {
      infoByKey.set(`${locId}|${m.externalCode}`, {
        id: m.id,
        items: m.items.map((i) => ({
          optionId: i.optionId,
          quantity: i.quantity,
          productName: i.option.product.name,
          optionName: i.option.name,
        })),
      })
    }
  }

  return entries.map((e) => {
    if ((e.status === 'matched-equal' || e.status === 'matched-diff') && e.row?.externalCode) {
      const locId = (e as MatchEntry & { locationId?: string }).locationId ?? reconLocationId
      const info = infoByKey.get(`${locId}|${e.row.externalCode}`)
      if (info) return { ...e, mappingId: info.id, mappingItems: info.items }
    }
    return e
  })
}

/**
 * file-only 항목 중 InvLocationProductMap에 매핑이 생긴 것을
 * 현재 InvStockLevel 기준으로 N entries (matched-equal/matched-diff)로 변환한다.
 * items 수만큼 entry 분리. 매핑이 없는 file-only는 그대로 유지.
 */
async function resolveFileOnlyEntries(
  entries: MatchEntry[],
  reconLocationId: string
): Promise<MatchEntry[]> {
  const fileOnlyEntries = entries.filter((e): e is FileOnlyEntry => e.status === 'file-only')
  if (fileOnlyEntries.length === 0) return entries

  // (locationId, externalCode) 페어 수집
  const codesByLoc = new Map<string, Set<string>>()
  for (const e of fileOnlyEntries) {
    if (!e.row.externalCode) continue
    const locId = e.locationId ?? reconLocationId
    const s = codesByLoc.get(locId) ?? new Set()
    s.add(e.row.externalCode)
    codesByLoc.set(locId, s)
  }
  if (codesByLoc.size === 0) return entries

  type MappingFull = {
    items: {
      optionId: string
      quantity: number
      option: { name: string; product: { name: string } }
    }[]
  }
  const mappingByKey = new Map<string, MappingFull>() // `${locId}|${code}`
  const stockByKey = new Map<string, number>() // `${locId}|${optionId}`

  for (const [locId, codeSet] of codesByLoc) {
    const mappings = await prisma.invLocationProductMap.findMany({
      where: { locationId: locId, externalCode: { in: Array.from(codeSet) } },
      include: {
        items: {
          include: {
            option: { include: { product: { select: { name: true } } } },
          },
        },
      },
    })
    for (const m of mappings) {
      mappingByKey.set(`${locId}|${m.externalCode}`, { items: m.items })
    }
    const optionIds = mappings.flatMap((m) => m.items.map((i) => i.optionId))
    if (optionIds.length === 0) continue
    const stocks = await prisma.invStockLevel.findMany({
      where: { locationId: locId, optionId: { in: optionIds } },
    })
    for (const s of stocks) stockByKey.set(`${locId}|${s.optionId}`, s.quantity)
  }

  const result: MatchEntry[] = []
  for (const entry of entries) {
    if (entry.status !== 'file-only') {
      result.push(entry)
      continue
    }
    const locId = entry.locationId ?? reconLocationId
    if (!entry.row.externalCode) {
      result.push(entry)
      continue
    }
    const mapping = mappingByKey.get(`${locId}|${entry.row.externalCode}`)
    if (!mapping || mapping.items.length === 0) {
      result.push(entry)
      continue
    }

    for (const item of mapping.items) {
      const systemQty = stockByKey.get(`${locId}|${item.optionId}`) ?? 0
      const fileQty = entry.row.quantity * item.quantity

      if (fileQty === systemQty) {
        result.push({
          status: 'matched-equal' as const,
          row: entry.row,
          optionId: item.optionId,
          locationId: locId,
          productName: item.option.product.name,
          optionName: item.option.name,
          mapItemQuantity: item.quantity,
          systemQuantity: systemQty,
          fileQuantity: fileQty,
        })
      } else {
        result.push({
          status: 'matched-diff' as const,
          row: entry.row,
          optionId: item.optionId,
          locationId: locId,
          productName: item.option.product.name,
          optionName: item.option.name,
          mapItemQuantity: item.quantity,
          systemQuantity: systemQty,
          fileQuantity: fileQty,
          delta: fileQty - systemQty,
        })
      }
    }
  }

  return result
}

// POST /api/sh/inventory/reconciliation/[id]
// { action: 'confirm', selectedOptionIds: string[], manualMappings: [{externalCode, items:[{optionId,quantity}]}] }
// { action: 'finalize' }
// { action: 'cancel' }
// { action: 'map', externalCode: string, items: [{optionId: string, quantity?: number}] }
export async function POST(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const recon = await prisma.invReconciliation.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true, locationId: true, matchResults: true },
  })
  if (!recon) return errorResponse('대조 기록을 찾을 수 없습니다', 404)

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    selectedOptionIds?: string[]
    manualMappings?: { externalCode: string; items: { optionId: string; quantity?: number }[] }[]
    externalCode?: string
    items?: { optionId: string; quantity?: number }[]
    locationId?: string
  }

  if (body.action === 'confirm') {
    try {
      const result = await confirmReconciliation(resolved.space.id, id, {
        selectedOptionIds: body.selectedOptionIds ?? [],
        manualMappings: (body.manualMappings ?? []).map((mm) => ({
          externalCode: mm.externalCode,
          items: (mm.items ?? []).map((i) => ({
            optionId: i.optionId,
            quantity: i.quantity ?? 1,
          })),
        })),
      })
      return NextResponse.json({ success: true, ...result })
    } catch (err) {
      if (err instanceof MovementError) {
        return errorResponse(err.message, err.status)
      }
      console.error('[reconciliation confirm] 실패', err)
      return errorResponse('확정 처리에 실패했습니다', 500)
    }
  }

  if (body.action === 'finalize') {
    if (recon.status !== 'APPLIED') {
      return errorResponse('모든 항목이 적용된 상태(APPLIED)에서만 확정할 수 있습니다', 400)
    }
    await prisma.invReconciliation.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    })
    return NextResponse.json({ success: true, status: 'CONFIRMED' })
  }

  if (body.action === 'cancel') {
    if (!['PENDING', 'PARTIAL'].includes(recon.status)) {
      return errorResponse(
        '대기 중(PENDING) 또는 부분 적용(PARTIAL) 상태에서만 취소할 수 있습니다',
        400
      )
    }
    await prisma.invReconciliation.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'map') {
    const externalCode = body.externalCode?.trim()
    if (!externalCode) return errorResponse('externalCode가 필요합니다', 400)

    const rawItems = body.items ?? []
    if (rawItems.length === 0) {
      return errorResponse('items가 필요합니다', 400)
    }

    // 매핑 대상 location 결정: body.locationId > matchResults의 해당 entry.locationId > recon.locationId
    let mapLocationId: string = body.locationId ?? recon.locationId
    if (!body.locationId) {
      const matchEntries = (recon.matchResults ?? []) as MatchEntry[]
      const hit = matchEntries.find(
        (e) =>
          (e.status === 'file-only' ||
            e.status === 'matched-equal' ||
            e.status === 'matched-diff') &&
          e.row?.externalCode === externalCode &&
          (e as MatchEntry & { locationId?: string }).locationId
      )
      if (hit) {
        const locId = (hit as MatchEntry & { locationId?: string }).locationId
        if (locId) mapLocationId = locId
      }
    }
    // 소유권 검증 — 해당 space의 location인지 확인
    const locOk = await prisma.invStorageLocation.findFirst({
      where: { id: mapLocationId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!locOk) return errorResponse('대상 보관 장소를 찾을 수 없습니다', 404)

    // 옵션 소유권 검증
    const validOptions = await prisma.invProductOption.findMany({
      where: {
        id: { in: rawItems.map((i) => i.optionId) },
        product: { spaceId: resolved.space.id },
      },
      select: { id: true },
    })
    const validOptionIds = new Set(validOptions.map((o) => o.id))
    const validItems = rawItems.filter((i) => validOptionIds.has(i.optionId))
    if (validItems.length === 0) return errorResponse('유효한 상품 옵션이 없습니다', 404)

    // Upsert mapping
    const existing = await prisma.invLocationProductMap.findUnique({
      where: { locationId_externalCode: { locationId: mapLocationId, externalCode } },
    })
    let mapId: string
    if (existing) {
      mapId = existing.id
    } else {
      const created = await prisma.invLocationProductMap.create({
        data: {
          spaceId: resolved.space.id,
          locationId: mapLocationId,
          externalCode,
        },
      })
      mapId = created.id
    }

    // items 교체
    await prisma.invLocationProductMapItem.deleteMany({ where: { mapId } })
    await prisma.invLocationProductMapItem.createMany({
      data: validItems.map((i) => ({
        mapId,
        optionId: i.optionId,
        quantity: i.quantity ?? 1,
      })),
    })

    const mapping = await prisma.invLocationProductMap.findUnique({
      where: { id: mapId },
      include: {
        items: {
          include: {
            option: { include: { product: { select: { name: true } } } },
          },
        },
      },
    })
    return NextResponse.json({ mapping })
  }

  return errorResponse('알 수 없는 action 입니다', 400)
}

// DELETE /api/sh/inventory/reconciliation/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const recon = await prisma.invReconciliation.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!recon) return errorResponse('대조 기록을 찾을 수 없습니다', 404)

  if (['APPLIED', 'CONFIRMED'].includes(recon.status)) {
    return errorResponse('적용 완료 또는 확정된 대조는 삭제할 수 없습니다', 400)
  }

  await prisma.invReconciliation.delete({ where: { id } })
  return NextResponse.json({ success: true })
}

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

  // 이 대조에 이미 적용된 optionId 목록
  const movements = await prisma.invMovement.findMany({
    where: { referenceId: id, type: 'ADJUSTMENT' },
    select: { optionId: true },
    distinct: ['optionId'],
  })
  const appliedOptionIds = movements.map((m) => m.optionId)

  // matchResults 후처리: file-only 중 InvLocationProductMap에 매핑된 항목은
  // 현재 시스템 재고를 기준으로 matched-equal/matched-diff로 가상 변환한다.
  // (스냅샷 DB는 수정하지 않음)
  const rawEntries = (recon.matchResults ?? []) as MatchEntry[]
  const resolved2 = await resolveFileOnlyEntries(rawEntries, recon.locationId)

  // matched-equal/matched-diff 항목에 mappingId를 함께 내려준다 (매칭 수정 PATCH용).
  const matchResults = await attachMappingIds(resolved2, recon.locationId)

  return NextResponse.json({ reconciliation: { ...recon, matchResults, appliedOptionIds } })
}

/**
 * matched-equal/matched-diff 항목에 InvLocationProductMap.id(mappingId)를 첨부한다.
 * UI의 [매칭 수정] PATCH가 mappingId를 필요로 한다.
 */
async function attachMappingIds(
  entries: (MatchEntry & { mappingId?: string })[],
  locationId: string
): Promise<(MatchEntry & { mappingId?: string })[]> {
  const codes: string[] = []
  for (const e of entries) {
    if ((e.status === 'matched-equal' || e.status === 'matched-diff') && e.row?.externalCode) {
      codes.push(e.row.externalCode)
    }
  }
  if (codes.length === 0) return entries

  const mappings = await prisma.invLocationProductMap.findMany({
    where: { locationId, externalCode: { in: codes } },
    select: { id: true, externalCode: true },
  })
  const idByCode = new Map<string, string>()
  for (const m of mappings) idByCode.set(m.externalCode, m.id)

  return entries.map((e) => {
    if (
      (e.status === 'matched-equal' || e.status === 'matched-diff') &&
      e.row?.externalCode &&
      idByCode.has(e.row.externalCode)
    ) {
      return { ...e, mappingId: idByCode.get(e.row.externalCode) }
    }
    return e
  })
}

/**
 * file-only 항목 중 InvLocationProductMap에 매핑이 생긴 것을
 * 현재 InvStockLevel 기준으로 matched-equal/matched-diff로 가상 변환한다.
 * 매핑이 없는 file-only는 그대로 유지한다.
 */
async function resolveFileOnlyEntries(
  entries: MatchEntry[],
  locationId: string
): Promise<MatchEntry[]> {
  // file-only 항목만 추출
  const fileOnlyEntries = entries.filter((e): e is FileOnlyEntry => e.status === 'file-only')
  if (fileOnlyEntries.length === 0) return entries

  const externalCodes = fileOnlyEntries.map((e) => e.row.externalCode)

  // 해당 externalCode들에 매핑이 있는지 일괄 조회
  const mappings = await prisma.invLocationProductMap.findMany({
    where: { locationId, externalCode: { in: externalCodes } },
    include: {
      option: { include: { product: { select: { name: true } } } },
    },
  })
  if (mappings.length === 0) return entries

  const mappingByCode = new Map<string, (typeof mappings)[number]>()
  for (const m of mappings) mappingByCode.set(m.externalCode, m)

  // 매핑된 optionId의 현재 시스템 재고 일괄 조회 (reconciliation-matcher와 동일 패턴)
  const mappedOptionIds = mappings.map((m) => m.optionId)
  const stocks = await prisma.invStockLevel.findMany({
    where: { locationId, optionId: { in: mappedOptionIds } },
  })
  const stockByOption = new Map<string, number>()
  for (const s of stocks) stockByOption.set(s.optionId, s.quantity)

  return entries.map((entry) => {
    if (entry.status !== 'file-only') return entry

    const mapping = mappingByCode.get(entry.row.externalCode)
    if (!mapping) return entry // 매핑 없음 — file-only 유지

    const systemQty = stockByOption.get(mapping.optionId) ?? 0
    const fileQty = entry.row.quantity

    if (fileQty === systemQty) {
      return {
        status: 'matched-equal' as const,
        row: entry.row,
        optionId: mapping.optionId,
        productName: mapping.option.product.name,
        optionName: mapping.option.name,
        systemQuantity: systemQty,
      }
    } else {
      return {
        status: 'matched-diff' as const,
        row: entry.row,
        optionId: mapping.optionId,
        productName: mapping.option.product.name,
        optionName: mapping.option.name,
        systemQuantity: systemQty,
        fileQuantity: fileQty,
        delta: fileQty - systemQty,
      }
    }
  })
}

// POST /api/sh/inventory/reconciliation/[id]
// { action: 'confirm', selectedOptionIds, manualMappings }
// { action: 'finalize' }
// { action: 'cancel' }
// { action: 'map', externalCode, optionId }
export async function POST(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const recon = await prisma.invReconciliation.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true, locationId: true },
  })
  if (!recon) return errorResponse('대조 기록을 찾을 수 없습니다', 404)

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    selectedOptionIds?: string[]
    manualMappings?: { externalCode: string; optionId: string }[]
    externalCode?: string
    optionId?: string
  }

  if (body.action === 'confirm') {
    try {
      const result = await confirmReconciliation(resolved.space.id, id, {
        selectedOptionIds: body.selectedOptionIds ?? [],
        manualMappings: body.manualMappings ?? [],
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
    // APPLIED 상태에서만 최종 확정 허용
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
    // PENDING/PARTIAL 상태에서만 취소 허용
    // APPLIED 이후(APPLIED/CONFIRMED/CANCELLED)는 이미 movement가 기록됐거나 종결된 상태
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
    const optionId = body.optionId?.trim()
    if (!externalCode || !optionId) {
      return errorResponse('externalCode 와 optionId 가 필요합니다', 400)
    }
    const option = await prisma.invProductOption.findFirst({
      where: { id: optionId, product: { spaceId: resolved.space.id } },
      select: { id: true },
    })
    if (!option) return errorResponse('상품 옵션을 찾을 수 없습니다', 404)

    const existing = await prisma.invLocationProductMap.findUnique({
      where: {
        locationId_externalCode: { locationId: recon.locationId, externalCode },
      },
    })
    const mapping = existing
      ? await prisma.invLocationProductMap.update({
          where: { id: existing.id },
          data: { optionId },
        })
      : await prisma.invLocationProductMap.create({
          data: {
            spaceId: resolved.space.id,
            locationId: recon.locationId,
            optionId,
            externalCode,
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

  // APPLIED/CONFIRMED 상태는 삭제 불가
  if (['APPLIED', 'CONFIRMED'].includes(recon.status)) {
    return errorResponse('적용 완료 또는 확정된 대조는 삭제할 수 없습니다', 400)
  }

  await prisma.invReconciliation.delete({ where: { id } })
  return NextResponse.json({ success: true })
}

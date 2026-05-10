import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { confirmReconciliation } from '@/lib/inv/reconciliation-processor'
import { MovementError } from '@/lib/inv/movement-processor'

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

  return NextResponse.json({ reconciliation: { ...recon, appliedOptionIds } })
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

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { confirmReconciliation } from '@/lib/inv/reconciliation-processor'
import { MovementError } from '@/lib/inv/movement-processor'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/inv/reconciliation/[id]
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const recon = await prisma.invReconciliation.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: { location: { select: { id: true, name: true } } },
  })
  if (!recon) return errorResponse('대조 기록을 찾을 수 없습니다', 404)

  return NextResponse.json({ reconciliation: recon })
}

// POST /api/inv/reconciliation/[id]
// { action: 'confirm', selectedOptionIds, manualMappings } | { action: 'cancel' } | { action: 'map', externalCode, optionId }
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

  if (body.action === 'cancel') {
    if (recon.status !== 'PENDING') {
      return errorResponse('이미 처리된 대조입니다', 400)
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

// DELETE /api/inv/reconciliation/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const recon = await prisma.invReconciliation.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!recon) return errorResponse('대조 기록을 찾을 수 없습니다', 404)
  if (recon.status === 'CONFIRMED') {
    return errorResponse('확정된 대조는 삭제할 수 없습니다', 400)
  }

  await prisma.invReconciliation.delete({ where: { id } })
  return NextResponse.json({ success: true })
}

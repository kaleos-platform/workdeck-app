import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { seedFinanceCategories, ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'
import { canUseDeck, ensureTrialStarted } from '@/lib/billing/entitlement'

type CreateDeckRequest = {
  deckAppId?: string
}

// POST /api/spaces/decks — 현재 Space에 Deck 활성화
export async function POST(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error

  const body = (await request.json().catch(() => null)) as CreateDeckRequest | null
  const deckAppId = typeof body?.deckAppId === 'string' ? body.deckAppId.trim() : ''
  if (!deckAppId) return errorResponse('deckAppId가 필요합니다', 400)

  const deckApp = await prisma.deckApp.findUnique({
    where: { id: deckAppId },
    select: { id: true, name: true, description: true, isActive: true },
  })
  if (!deckApp || !deckApp.isActive) {
    return errorResponse('사용 가능한 업무가 아닙니다', 404)
  }

  // 유료 deck 첫 사용 시도 → Trial lazy-start (평생 1회, 이력 있으면 no-op)
  const product = await prisma.billingDeckProduct.findUnique({ where: { id: deckAppId } })
  if (product?.isActive && product.pricingMode === 'SUBSCRIPTION') {
    await ensureTrialStarted(resolved.space.id)
  }

  // entitlement 게이트: 무료 베타·면제·구독·Trial·유예 전부 아니면 402
  if (!(await canUseDeck(resolved.space.id, deckAppId))) {
    return errorResponse('구독이 필요한 업무입니다', 402)
  }

  const existing = await prisma.deckInstance.findUnique({
    where: {
      spaceId_deckAppId: {
        spaceId: resolved.space.id,
        deckAppId,
      },
    },
    select: { id: true, isActive: true },
  })

  if (existing?.isActive) {
    // 이미 활성이어도 계정과목이 비었으면(이전 시드 실패) 재추가 시 복구
    if (deckAppId === 'finance') await ensureFinanceSeeded(resolved.space.id)
    return errorResponse('이미 사용 중인 업무입니다', 409)
  }

  if (existing) {
    const updated = await prisma.deckInstance.update({
      where: { id: existing.id },
      data: { isActive: true },
      select: { id: true, deckAppId: true, isActive: true },
    })
    if (deckAppId === 'finance') await seedFinanceCategories(resolved.space.id)
    return NextResponse.json({ deck: deckApp, instance: updated })
  }

  const created = await prisma.deckInstance.create({
    data: {
      spaceId: resolved.space.id,
      deckAppId,
      isActive: true,
    },
    select: { id: true, deckAppId: true, isActive: true },
  })

  if (deckAppId === 'finance') await seedFinanceCategories(resolved.space.id)

  return NextResponse.json({ deck: deckApp, instance: created }, { status: 201 })
}

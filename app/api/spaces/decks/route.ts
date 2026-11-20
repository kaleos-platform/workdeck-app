import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { seedFinanceCategories, ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'
import { EnableDeckError, enableDeckInTx } from '@/lib/spaces/enable-deck'

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

  try {
    const { instance, reactivated } = await prisma.$transaction((tx) =>
      enableDeckInTx(tx, resolved.space.id, deckAppId)
    )
    if (deckAppId === 'finance') await seedFinanceCategories(resolved.space.id)
    return NextResponse.json({ deck: deckApp, instance }, { status: reactivated ? 200 : 201 })
  } catch (error) {
    if (error instanceof EnableDeckError) {
      if (error.code === 'DECK_CLOSED') return errorResponse('준비중인 업무입니다', 403)
      if (error.code === 'DECK_ALREADY_ACTIVE') {
        // 이미 활성이어도 계정과목이 비었으면(이전 시드 실패) 재추가 시 복구
        if (deckAppId === 'finance') await ensureFinanceSeeded(resolved.space.id)
        return errorResponse('이미 사용 중인 업무입니다', 409)
      }
      return errorResponse('구독이 필요한 업무입니다', 402, { code: 'DECK_SUBSCRIPTION_REQUIRED' })
    }
    return errorResponse('업무를 활성화하지 못했습니다', 500)
  }
}

// DELETE /api/spaces/decks — 현재 Space에서 Deck 비활성화(사용 중지).
// 구독 해지(SubscriptionItem)와는 다른 개념이다. 무료 제공·유예·Trial 처럼
// 구독 아이템이 없는 업무를 목록에서 내릴 때 쓴다. 데이터는 지우지 않는다.
export async function DELETE(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error

  const body = (await request.json().catch(() => null)) as CreateDeckRequest | null
  const deckAppId = typeof body?.deckAppId === 'string' ? body.deckAppId.trim() : ''
  if (!deckAppId) return errorResponse('deckAppId가 필요합니다', 400)

  const existing = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId: resolved.space.id, deckAppId } },
    select: { id: true, isActive: true },
  })
  if (!existing?.isActive) return errorResponse('사용 중인 업무가 아닙니다', 404)

  await prisma.deckInstance.update({
    where: { id: existing.id },
    data: { isActive: false },
  })

  return NextResponse.json({ deckAppId, isActive: false })
}

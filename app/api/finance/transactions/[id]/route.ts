/**
 * PATCH /api/finance/transactions/[id]
 * 확정 거래의 계정과목을 재분류한다(+ 규칙 학습). isTransfer 토글·메모 수정 지원.
 *   body: { categoryId?, learn?(기본 true), isTransfer?, memo? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { learnRule } from '@/lib/finance/classify'
import { normalizeMemoInput } from '@/lib/finance/memo'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const txn = await prisma.finTransaction.findFirst({
    where: { id, spaceId },
    select: { id: true, description: true, counterparty: true, direction: true },
  })
  if (!txn) return errorResponse('거래를 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const data: {
    categoryId?: string
    classStatus?: 'CLASSIFIED'
    matchedRuleId?: string | null
    isTransfer?: boolean
    liabilityId?: string | null
    memo?: string | null
  } = {}

  // 부채 연결/해제 — 상환 거래를 특정 부채에 귀속(감지·잔액반영의 근거)
  if (body?.liabilityId !== undefined) {
    if (body.liabilityId === null || body.liabilityId === '') {
      data.liabilityId = null
    } else if (typeof body.liabilityId === 'string') {
      const liability = await prisma.finLiability.findFirst({
        where: { id: body.liabilityId, spaceId },
        select: { id: true },
      })
      if (!liability) return errorResponse('부채를 찾을 수 없습니다', 400)
      data.liabilityId = body.liabilityId
    }
  }

  if (typeof body?.categoryId === 'string' && body.categoryId) {
    const category = await prisma.finCategory.findFirst({
      where: { id: body.categoryId, spaceId },
      select: { id: true, type: true },
    })
    if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)
    data.categoryId = body.categoryId
    data.classStatus = 'CLASSIFIED'
    data.isTransfer = category.type === 'TRANSFER'

    if (body.learn !== false) {
      data.matchedRuleId = await learnRule(
        spaceId,
        { description: txn.description, counterparty: txn.counterparty },
        body.categoryId,
        txn.direction
      )
    }
  }

  if (typeof body?.isTransfer === 'boolean') data.isTransfer = body.isTransfer

  // 메모
  if (body?.memo !== undefined) {
    const m = normalizeMemoInput(body.memo)
    if (!m.ok) return errorResponse(m.error, 400)
    data.memo = m.value ?? null
  }

  if (Object.keys(data).length === 0) return errorResponse('변경할 내용이 없습니다', 400)

  const updated = await prisma.finTransaction.update({
    where: { id },
    data,
    select: {
      id: true,
      categoryId: true,
      classStatus: true,
      isTransfer: true,
      matchedRuleId: true,
      liabilityId: true,
      memo: true,
      category: {
        select: { id: true, name: true, type: true, parent: { select: { name: true } } },
      },
    },
  })

  return NextResponse.json({ transaction: updated })
}

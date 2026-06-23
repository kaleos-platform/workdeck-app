/**
 * PATCH /api/finance/transactions/[id]
 * 확정 거래의 계정과목을 재분류한다(+ 규칙 학습). isTransfer 토글 지원.
 *   body: { categoryId?, learn?(기본 true), isTransfer? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { learnRule } from '@/lib/finance/classify'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const txn = await prisma.finTransaction.findFirst({
    where: { id, spaceId },
    select: { id: true, description: true, counterparty: true },
  })
  if (!txn) return errorResponse('거래를 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const data: {
    categoryId?: string
    classStatus?: 'CLASSIFIED'
    matchedRuleId?: string | null
    isTransfer?: boolean
  } = {}

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
        body.categoryId
      )
    }
  }

  if (typeof body?.isTransfer === 'boolean') data.isTransfer = body.isTransfer

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
      category: {
        select: { id: true, name: true, type: true, parent: { select: { name: true } } },
      },
    },
  })

  return NextResponse.json({ transaction: updated })
}

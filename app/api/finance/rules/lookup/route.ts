/**
 * GET /api/finance/rules/lookup?accountId&direction&description&counterparty&categoryId
 * 이 거래를 categoryId 로 「규칙 저장」하면 기존 규칙과 어떻게 부딪히는지 미리 알려준다(분류 확인 팝업 경고용).
 *   → { notice: { kind: 'REPLACED' | 'OVERRIDES', fromCategoryId, fromLabel } | null }
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { ruleNoticeFor } from '@/lib/finance/classify'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const accountId = sp.get('accountId') ?? ''
  const categoryId = sp.get('categoryId') ?? ''
  const direction = sp.get('direction')
  if (direction !== 'IN' && direction !== 'OUT') return errorResponse('direction이 필요합니다', 400)
  if (!categoryId) return errorResponse('categoryId가 필요합니다', 400)

  const account = await prisma.finAccount.findFirst({
    where: { id: accountId, spaceId },
    select: { id: true },
  })
  if (!account) return errorResponse('계좌를 찾을 수 없습니다', 400)

  const notice = await ruleNoticeFor(
    spaceId,
    { description: sp.get('description'), counterparty: sp.get('counterparty') },
    direction,
    account.id,
    categoryId
  )
  return NextResponse.json({ notice })
}

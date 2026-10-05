/**
 * POST /api/finance/rules/preview
 * 규칙 조건(키워드·일치 방식·계좌·계정과목 방향)에 걸리는 확정 거래 미리보기.
 *   body: { matchKey, matchType, accountId(null=전체 공통), categoryId }
 *   → { count, sameCategoryCount(그중 계정과목이 categoryId 인 건수), samples(최근 5건) }
 * 다른 규칙과의 우선순위는 반영하지 않는다(「이 조건이 걸리는 범위」 확인용).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeFinKey, directionForType } from '@/lib/finance/kifrs-seed'
import { loadMatchTexts } from '@/lib/finance/classify'
import { matchingTexts } from '@/lib/finance/rule-usage'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const matchKey = typeof body?.matchKey === 'string' ? normalizeFinKey(body.matchKey) : ''
  if (!matchKey) return errorResponse('키워드를 입력해 주세요', 400)
  if (body?.matchType !== 'EXACT' && body?.matchType !== 'KEYWORD')
    return errorResponse('matchType은 EXACT 또는 KEYWORD여야 합니다', 400)

  const category = await prisma.finCategory.findFirst({
    where: { id: String(body?.categoryId ?? ''), spaceId },
    select: { id: true, type: true },
  })
  if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)

  const accountId = typeof body?.accountId === 'string' && body.accountId ? body.accountId : null
  if (accountId) {
    const account = await prisma.finAccount.findFirst({
      where: { id: accountId, spaceId },
      select: { id: true },
    })
    if (!account) return errorResponse('계좌를 찾을 수 없습니다', 400)
  }

  const hits = matchingTexts(
    { accountId, matchKey, matchType: body.matchType, direction: directionForType(category.type) },
    await loadMatchTexts(spaceId, accountId)
  )
  const recentIds = [...hits]
    .sort((a, b) => b.txnDate.getTime() - a.txnDate.getTime())
    .slice(0, 5)
    .map((h) => h.id)
  const samples = await prisma.finTransaction.findMany({
    where: { id: { in: recentIds }, spaceId },
    orderBy: { txnDate: 'desc' },
    select: {
      id: true,
      txnDate: true,
      description: true,
      counterparty: true,
      account: { select: { name: true } },
    },
  })

  return NextResponse.json({
    count: hits.length,
    sameCategoryCount: hits.filter((h) => h.categoryId === category.id).length,
    samples,
  })
}

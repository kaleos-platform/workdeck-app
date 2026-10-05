/**
 * POST /api/finance/rules/preview
 * 규칙 조건(키워드·일치 방식·계좌·계정과목 방향)에 걸리는 확정 거래 미리보기.
 *   body: { matchKey, matchType, accountId(null=전체 공통), categoryId, ruleId?(수정 중 규칙 — 방향 유지 기준) }
 *   → { count, sameCategoryCount(그중 계정과목이 categoryId 인 건수), samples(최근 5건),
 *       applicableCount(ruleId 지정 시: 그중 지금 이 규칙이 실제 적용되는 건수 — PATCH applyToExisting 대상과 같은 기준) }
 * 다른 규칙과의 우선순위는 반영하지 않는다(「이 조건이 걸리는 범위」 확인용).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeFinKey, directionForType } from '@/lib/finance/kifrs-seed'
import { classifyRow, loadMatchTexts, loadSpaceRules } from '@/lib/finance/classify'
import { matchingTexts } from '@/lib/finance/rule-usage'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance', { write: true })
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

  // 방향: PATCH 와 같은 규칙 — 방향 없는 type(이체 등)이면 수정 중 규칙의 기존 방향.
  const editingRule =
    typeof body?.ruleId === 'string' && body.ruleId
      ? await prisma.finClassRule.findFirst({
          where: { id: body.ruleId, spaceId },
          select: { direction: true },
        })
      : null
  const direction = directionForType(category.type) ?? editingRule?.direction ?? null

  const hits = matchingTexts(
    { accountId, matchKey, matchType: body.matchType, direction },
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

  // 수정 중 규칙의 「기존 거래 함께 변경」 대상 수 — PATCH 와 같은 기준(우선순위로 이 규칙이 적용되는 거래만).
  let applicableCount: number | null = null
  if (editingRule) {
    const rules = await loadSpaceRules(spaceId)
    applicableCount = hits.filter(
      (h) =>
        h.categoryId === category.id &&
        classifyRow({ description: h.text }, rules, h.direction, h.accountId).matchedRuleId ===
          body.ruleId
    ).length
  }

  return NextResponse.json({
    applicableCount,
    count: hits.length,
    sameCategoryCount: hits.filter((h) => h.categoryId === category.id).length,
    samples,
  })
}

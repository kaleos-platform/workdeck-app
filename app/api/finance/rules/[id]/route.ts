/**
 * PATCH  /api/finance/rules/[id] — 분류 규칙 수정(키워드·일치 방식·계정과목·계좌·메모).
 *   body: { matchKey?, matchType?, categoryId?, accountId?(null=전체 공통), memo?, applyToExisting? }
 *   - 방향은 계정과목 type 에서 재유도. 다른 규칙과 (계좌, 키워드, 방향)이 겹치면 409.
 *   - applyToExisting + 계정과목 변경: 수정 전 조건에 걸리고 계정과목이 수정 전 값 그대로인 확정 거래만
 *     새 계정과목으로(이후 사용자가 다른 계정으로 바꾼 거래는 유지).
 *   - 확인·처리 대기 행은 항상 최신 규칙으로 재분류.
 * DELETE /api/finance/rules/[id] — 삭제 후 이 규칙으로 분류됐던 대기 행을 남은 규칙으로 재분류.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeFinKey, directionForType } from '@/lib/finance/kifrs-seed'
import { normalizeMemoInput } from '@/lib/finance/memo'
import {
  classifyRow,
  loadMatchTexts,
  loadSpaceRules,
  reclassifyDraftStagedRows,
} from '@/lib/finance/classify'
import { matchingTexts } from '@/lib/finance/rule-usage'
import { categoryLabelOf } from '@/lib/finance/category-options'

const VALID_MATCH_TYPES = ['EXACT', 'KEYWORD'] as const
type MatchType = (typeof VALID_MATCH_TYPES)[number]

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance', { write: true })
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const rule = await prisma.finClassRule.findFirst({ where: { id, spaceId } })
  if (!rule) return errorResponse('분류 규칙을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))

  let matchKey = rule.matchKey
  if (body?.matchKey !== undefined) {
    if (typeof body.matchKey !== 'string' || !body.matchKey.trim())
      return errorResponse('키워드를 입력해 주세요', 400)
    matchKey = normalizeFinKey(body.matchKey)
  }

  let matchType: MatchType = rule.matchType
  if (body?.matchType !== undefined) {
    if (!VALID_MATCH_TYPES.includes(body.matchType))
      return errorResponse('matchType은 EXACT 또는 KEYWORD여야 합니다', 400)
    matchType = body.matchType
  }

  const categoryId: string =
    typeof body?.categoryId === 'string' && body.categoryId ? body.categoryId : rule.categoryId
  const category = await prisma.finCategory.findFirst({
    where: { id: categoryId, spaceId },
    select: { id: true, type: true },
  })
  if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)
  // 방향은 계정과목 type 에서 유도하되, 방향 없는 type(이체·자산·부채)이면 규칙의 기존 방향을 유지한다.
  // 학습 규칙은 거래 방향(IN/OUT)을 저장하므로, null 로 바꾸면 반대 방향 거래까지 매칭되고
  // 같은 적요의 IN·OUT 이체 규칙 쌍이 서로 충돌(409)해 수정할 수 없게 된다.
  const direction = directionForType(category.type) ?? rule.direction

  let accountId = rule.accountId
  if (body?.accountId !== undefined) {
    if (body.accountId === null || body.accountId === '') {
      accountId = null
    } else if (typeof body.accountId === 'string') {
      const account = await prisma.finAccount.findFirst({
        where: { id: body.accountId, spaceId },
        select: { id: true },
      })
      if (!account) return errorResponse('계좌를 찾을 수 없습니다', 400)
      accountId = account.id
    }
  }

  let memo = rule.memo
  if (body?.memo !== undefined) {
    const m = normalizeMemoInput(body.memo)
    if (!m.ok) return errorResponse(m.error, 400)
    memo = m.value ?? null
  }

  // 자기 자신을 뺀 같은 조건 규칙 — 두 규칙이 조용히 하나로 합쳐지지 않게 차단.
  const clash = await prisma.finClassRule.findFirst({
    where: { spaceId, accountId, matchKey, direction, id: { not: id } },
    select: { id: true, category: { select: { name: true, parent: { select: { name: true } } } } },
  })
  if (clash) {
    return errorResponse('같은 조건의 규칙이 이미 있습니다', 409, {
      existing: { id: clash.id, categoryLabel: categoryLabelOf(clash.category) },
    })
  }

  // 기존 거래 함께 변경 대상 — 수정 "전" 조건에 걸리고, 계정과목이 수정 전 값 그대로이며,
  // 지금 규칙셋에서 실제로 이 규칙이 적용되는(다른 규칙이 우선하지 않는) 거래만.
  // 우선순위를 무시하면 다른 규칙이 관할하는 과거 거래까지 바뀌어, 같은 적요의 새 거래와 분류가 갈린다.
  const categoryChanged = categoryId !== rule.categoryId
  let applyIds: string[] = []
  if (body?.applyToExisting === true && categoryChanged) {
    const [texts, rulesBefore] = await Promise.all([
      loadMatchTexts(spaceId, rule.accountId),
      loadSpaceRules(spaceId),
    ])
    applyIds = matchingTexts(rule, texts)
      .filter(
        (t) =>
          t.categoryId === rule.categoryId &&
          classifyRow({ description: t.text }, rulesBefore, t.direction, t.accountId)
            .matchedRuleId === rule.id
      )
      .map((t) => t.id)
  }

  const [updated, applied] = await prisma.$transaction([
    prisma.finClassRule.update({
      where: { id },
      data: { matchKey, matchType, categoryId, accountId, direction, memo, learnedFrom: 'USER' },
      include: {
        category: {
          select: { id: true, name: true, type: true, parent: { select: { name: true } } },
        },
        account: { select: { id: true, name: true, kind: true, accountNumber: true } },
      },
    }),
    prisma.finTransaction.updateMany({
      where: { id: { in: applyIds }, spaceId },
      data: {
        categoryId,
        classStatus: 'CLASSIFIED',
        isTransfer: category.type === 'TRANSFER',
      },
    }),
  ])

  const reclassifiedStaged = await reclassifyDraftStagedRows(spaceId, id)

  return NextResponse.json({
    rule: updated,
    updatedTransactions: applied.count,
    reclassifiedStaged,
  })
}

// 삭제: 분류 규칙 제거
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance', { write: true })
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const { id } = await params

  const existing = await prisma.finClassRule.findFirst({
    where: { id, spaceId },
    select: { id: true },
  })
  if (!existing) return errorResponse('분류 규칙을 찾을 수 없습니다', 404)

  await prisma.finClassRule.delete({ where: { id } })

  // 삭제된 규칙으로 자동분류된 대기(DRAFT) 행을 남은 규칙(예: 공통 규칙)으로 다시 분류한다.
  // 매칭이 없으면 미분류로 돌아간다. memo 는 사용자 편집분과 구분 불가하므로 보존.
  const reclassifiedStaged = await reclassifyDraftStagedRows(spaceId, id)

  return NextResponse.json({ ok: true, reclassifiedStaged })
}

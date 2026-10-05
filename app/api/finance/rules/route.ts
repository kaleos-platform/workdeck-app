import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeFinKey, directionForType } from '@/lib/finance/kifrs-seed'
import { normalizeMemoInput } from '@/lib/finance/memo'
import { loadMatchTexts } from '@/lib/finance/classify'
import { computeRuleUsage } from '@/lib/finance/rule-usage'
import { categoryLabelOf } from '@/lib/finance/category-options'

const VALID_MATCH_TYPES = ['EXACT', 'KEYWORD'] as const
type MatchType = (typeof VALID_MATCH_TYPES)[number]

const RULE_INCLUDE = {
  category: {
    select: { id: true, name: true, type: true, parent: { select: { name: true } } },
  },
  account: { select: { id: true, name: true, kind: true } },
} as const

// 조회: spaceId 기준 분류 규칙 전체 (updatedAt desc) + 계좌 + 사용 현황(텍스트 매칭 기준, rule-usage.ts).
export async function GET() {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const [rules, texts] = await Promise.all([
    prisma.finClassRule.findMany({
      where: { spaceId },
      orderBy: { updatedAt: 'desc' },
      include: RULE_INCLUDE,
    }),
    loadMatchTexts(spaceId),
  ])
  const usage = computeRuleUsage(rules, texts)

  return NextResponse.json({
    rules: rules.map((r) => ({
      ...r,
      usage: usage.get(r.id) ?? { count: 0, lastMatchedAt: null },
    })),
  })
}

// 생성: 수동 분류 규칙 추가. 같은 (계좌, 키워드, 방향) 규칙이 있으면 409 — 조용히 덮어쓰지 않는다
// (바꾸려면 그 규칙을 수정). accountId 생략/null = 전체 계좌 공통.
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const { matchKey, categoryId, matchType, accountId } = body as {
    matchKey?: string
    categoryId?: string
    matchType?: string
    accountId?: string | null
  }

  if (!matchKey || typeof matchKey !== 'string' || matchKey.trim() === '') {
    return errorResponse('matchKey가 필요합니다', 400)
  }
  if (!categoryId || typeof categoryId !== 'string') {
    return errorResponse('categoryId가 필요합니다', 400)
  }
  if (!matchType || !VALID_MATCH_TYPES.includes(matchType as MatchType)) {
    return errorResponse('matchType은 EXACT 또는 KEYWORD여야 합니다', 400)
  }
  const memo = normalizeMemoInput(body?.memo)
  if (!memo.ok) return errorResponse(memo.error, 400)

  const normalizedKey = normalizeFinKey(matchKey)

  // categoryId spaceId 소유 검증 + 방향(type 기반) 유도
  const category = await prisma.finCategory.findFirst({
    where: { id: categoryId, spaceId },
    select: { id: true, type: true },
  })
  if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)
  const direction = directionForType(category.type)

  const scopeAccountId = typeof accountId === 'string' && accountId ? accountId : null
  if (scopeAccountId) {
    const account = await prisma.finAccount.findFirst({
      where: { id: scopeAccountId, spaceId },
      select: { id: true },
    })
    if (!account) return errorResponse('계좌를 찾을 수 없습니다', 400)
  }

  // (spaceId, accountId, matchKey, direction) — null 포함 가능해 복합 unique 대신 findFirst 로 검사.
  const existing = await prisma.finClassRule.findFirst({
    where: { spaceId, accountId: scopeAccountId, matchKey: normalizedKey, direction },
    select: { id: true, category: { select: { name: true, parent: { select: { name: true } } } } },
  })
  if (existing) {
    return errorResponse('같은 조건의 규칙이 이미 있습니다', 409, {
      existing: { id: existing.id, categoryLabel: categoryLabelOf(existing.category) },
    })
  }

  const rule = await prisma.finClassRule.create({
    data: {
      spaceId,
      accountId: scopeAccountId,
      matchKey: normalizedKey,
      categoryId,
      matchType: matchType as MatchType,
      learnedFrom: 'USER',
      direction,
      memo: memo.value ?? null,
    },
    include: RULE_INCLUDE,
  })

  return NextResponse.json({ rule }, { status: 201 })
}

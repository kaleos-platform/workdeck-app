import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeFinKey } from '@/lib/finance/kifrs-seed'

const VALID_MATCH_TYPES = ['EXACT', 'KEYWORD'] as const
type MatchType = (typeof VALID_MATCH_TYPES)[number]

// 조회: spaceId 기준 분류 규칙 전체 (updatedAt desc), 카테고리 정보 포함
export async function GET() {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const rules = await prisma.finClassRule.findMany({
    where: { spaceId },
    orderBy: { updatedAt: 'desc' },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          parent: { select: { name: true } },
        },
      },
    },
  })

  return NextResponse.json({ rules })
}

// 생성: 수동 분류 규칙 추가 (matchKey 정규화, spaceId+matchKey upsert)
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const { matchKey, categoryId, matchType } = body as {
    matchKey?: string
    categoryId?: string
    matchType?: string
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

  // matchKey 정규화
  const normalizedKey = normalizeFinKey(matchKey)

  // categoryId spaceId 소유 검증
  const category = await prisma.finCategory.findFirst({
    where: { id: categoryId, spaceId },
    select: { id: true },
  })
  if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)

  // (spaceId, matchKey) upsert — 있으면 categoryId/matchType 갱신
  const rule = await prisma.finClassRule.upsert({
    where: { spaceId_matchKey: { spaceId, matchKey: normalizedKey } },
    update: {
      categoryId,
      matchType: matchType as MatchType,
      learnedFrom: 'USER',
    },
    create: {
      spaceId,
      matchKey: normalizedKey,
      categoryId,
      matchType: matchType as MatchType,
      learnedFrom: 'USER',
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          parent: { select: { name: true } },
        },
      },
    },
  })

  return NextResponse.json({ rule }, { status: 201 })
}

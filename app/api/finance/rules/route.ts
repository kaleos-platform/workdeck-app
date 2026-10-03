import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeFinKey, directionForType } from '@/lib/finance/kifrs-seed'

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

  // categoryId spaceId 소유 검증 + 방향(type 기반) 유도
  const category = await prisma.finCategory.findFirst({
    where: { id: categoryId, spaceId },
    select: { id: true, type: true },
  })
  if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)
  const direction = directionForType(category.type)

  // (spaceId, matchKey, direction) 멱등 — direction이 null일 수 있어 compound-unique upsert 대신
  // findFirst → update/create. 있으면 categoryId/matchType 갱신.
  const include = {
    category: { select: { id: true, name: true, parent: { select: { name: true } } } },
  }
  const existing = await prisma.finClassRule.findFirst({
    where: { spaceId, matchKey: normalizedKey, direction },
    select: { id: true },
  })
  // 기존 규칙 갱신(덮어쓰기) vs 신규 생성 — 클라이언트가 토스트를 구분하도록 created 반환.
  const created = !existing
  const rule = existing
    ? await prisma.finClassRule.update({
        where: { id: existing.id },
        data: { categoryId, matchType: matchType as MatchType, learnedFrom: 'USER' },
        include,
      })
    : await prisma.finClassRule.create({
        data: {
          spaceId,
          matchKey: normalizedKey,
          categoryId,
          matchType: matchType as MatchType,
          learnedFrom: 'USER',
          direction,
        },
        include,
      })

  return NextResponse.json({ rule, created }, { status: created ? 201 : 200 })
}

/**
 * POST /api/finance/staging/[id]/suggest-rule
 * 미분류 스테이징 행에 대해 "키워드(룰베이스)" 계정 추천 — AI 미사용, 즉시·무료.
 * 사용자 학습 규칙(FinClassRule) + 운영 차트 시드 키워드를 합쳐 classifyRow로 매칭한다.
 * 시드 키워드는 규칙으로 영속화하지 않고(자동 규칙 시드 금지 정책) 추천 시점에만 합성 규칙으로 쓴다.
 *
 * 제안만 반환 — 실제 분류/학습은 수락 후 PATCH /api/finance/staging/[id] 가 수행한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { classifyRow, loadSpaceRules, type ClassRuleLite } from '@/lib/finance/classify'
import {
  flattenOperationalLeaves,
  normalizeFinKey,
  directionForType,
} from '@/lib/finance/kifrs-seed'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const row = await prisma.finStagedRow.findFirst({
    where: { id, spaceId },
    select: { id: true, description: true, counterparty: true, direction: true },
  })
  if (!row) return errorResponse('스테이징 행을 찾을 수 없습니다', 404)

  const [spaceRules, cats] = await Promise.all([
    loadSpaceRules(spaceId),
    prisma.finCategory.findMany({
      where: { spaceId, isActive: true },
      select: { id: true, name: true, type: true },
    }),
  ])

  // 운영 항목 name+type → 이 space의 카테고리 id (시드 키워드를 space 카테고리에 매핑).
  const idByKey = new Map(cats.map((c) => [`${c.type}:${c.name}`, c.id]))
  const seedRules: ClassRuleLite[] = []
  for (const leaf of flattenOperationalLeaves()) {
    const catId = idByKey.get(`${leaf.type}:${leaf.name}`)
    if (!catId) continue
    for (const kw of leaf.kw) {
      const matchKey = normalizeFinKey(kw)
      if (!matchKey) continue
      seedRules.push({
        id: `seed:${matchKey}`,
        matchKey,
        matchType: 'KEYWORD',
        categoryId: catId,
        direction: directionForType(leaf.type),
      })
    }
  }

  const result = classifyRow(
    { description: row.description, counterparty: row.counterparty },
    [...spaceRules, ...seedRules],
    row.direction
  )
  if (!result.categoryId) return NextResponse.json({ suggestion: null })

  const cat = cats.find((c) => c.id === result.categoryId)
  const matchedSeed = result.matchedRuleId?.startsWith('seed:')
    ? result.matchedRuleId.slice('seed:'.length)
    : null
  const reason = matchedSeed ? `'${matchedSeed}' 키워드 일치` : '학습된 규칙과 일치'

  return NextResponse.json({
    suggestion: { categoryId: result.categoryId, categoryName: cat?.name ?? '', reason },
  })
}

/**
 * POST /api/finance/staging/[id]/suggest
 * 미분류 스테이징 행에 대해 AI가 운영 계정 항목을 제안한다(gap-fill, 사용자 액션 시에만 호출).
 * 제안만 반환 — 실제 분류/학습은 수락 후 PATCH /api/finance/staging/[id] 가 수행한다.
 *
 * 후보 = 방향에 맞는 분류 대상 리프(IN→수익+이체, OUT→비용+이체). 대분류(그룹)·루트·비활성 제외.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum } from '@/lib/finance/serialize'
import { suggestCategory, type SuggestCandidate } from '@/lib/finance/ai-suggest'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const row = await prisma.finStagedRow.findFirst({
    where: { id, spaceId },
    select: { id: true, description: true, counterparty: true, amount: true, direction: true },
  })
  if (!row) return errorResponse('스테이징 행을 찾을 수 없습니다', 404)

  const allowed: string[] =
    row.direction === 'IN' ? ['INCOME', 'TRANSFER'] : ['EXPENSE', 'TRANSFER']

  const cats = await prisma.finCategory.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, parentId: true, type: true },
  })
  const byId = new Map(cats.map((c) => [c.id, c]))
  const hasChild = new Set(cats.map((c) => c.parentId).filter((p): p is string => p !== null))

  // 분류 대상 리프 = 자식 없음 + 루트 아님(parentId 존재) + 허용 타입.
  const candidates: SuggestCandidate[] = cats
    .filter((c) => allowed.includes(c.type) && c.parentId !== null && !hasChild.has(c.id))
    .map((c) => {
      const parent = c.parentId ? byId.get(c.parentId) : null
      // 부모가 대분류(루트가 아님)면 그룹명으로, 부모가 루트면 그룹 없음(예: 이체 항목).
      const group = parent && parent.parentId !== null ? parent.name : null
      const kind = c.type === 'INCOME' ? '수입' : c.type === 'EXPENSE' ? '지출' : '이체'
      return { id: c.id, name: c.name, group, kind } as SuggestCandidate
    })

  if (candidates.length === 0) {
    return NextResponse.json({ suggestion: null })
  }

  const suggestion = await suggestCategory(
    {
      description: row.description,
      counterparty: row.counterparty,
      amount: toNum(row.amount),
      direction: row.direction,
    },
    candidates
  )

  return NextResponse.json({ suggestion })
}

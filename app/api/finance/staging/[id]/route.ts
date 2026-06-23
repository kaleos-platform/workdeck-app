/**
 * PATCH /api/finance/staging/[id]
 * 스테이징 행의 분류/중복 처리를 갱신한다.
 *   - categoryId 지정 → 분류 확정(CLASSIFIED). learn !== false 면 EXACT 규칙 학습(동일 적요 자동분류).
 *   - resolution 지정 → 중복 처리(NEW=유지/반영, DUP_SAME=제외, DUP_CHANGED=변경반영).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { learnRule } from '@/lib/finance/classify'
import type { FinStagedResolution } from '@/generated/prisma/enums'

const RESOLUTIONS: FinStagedResolution[] = ['NEW', 'DUP_SAME', 'DUP_CHANGED']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { id } = await params

  const row = await prisma.finStagedRow.findFirst({
    where: { id, spaceId },
    select: { id: true, description: true, counterparty: true },
  })
  if (!row) return errorResponse('스테이징 행을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const data: {
    categoryId?: string
    classStatus?: 'CLASSIFIED'
    matchedRuleId?: string | null
    resolution?: FinStagedResolution
  } = {}

  // 분류 확정 + 학습
  if (typeof body?.categoryId === 'string' && body.categoryId) {
    const category = await prisma.finCategory.findFirst({
      where: { id: body.categoryId, spaceId },
      select: { id: true },
    })
    if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)
    data.categoryId = body.categoryId
    data.classStatus = 'CLASSIFIED'

    if (body.learn !== false) {
      const ruleId = await learnRule(
        spaceId,
        { description: row.description, counterparty: row.counterparty },
        body.categoryId
      )
      data.matchedRuleId = ruleId
    }
  }

  // 중복 처리
  if (typeof body?.resolution === 'string') {
    if (!RESOLUTIONS.includes(body.resolution))
      return errorResponse('유효하지 않은 처리 값입니다', 400)
    data.resolution = body.resolution
  }

  if (Object.keys(data).length === 0) return errorResponse('변경할 내용이 없습니다', 400)

  const updated = await prisma.finStagedRow.update({
    where: { id },
    data,
    select: {
      id: true,
      categoryId: true,
      classStatus: true,
      resolution: true,
      matchedRuleId: true,
      category: { select: { id: true, name: true, parent: { select: { name: true } } } },
    },
  })

  return NextResponse.json({ row: updated })
}

/**
 * POST /api/finance/staging/bulk
 * 선택한 스테이징 행들을 일괄 처리한다.
 *   - categoryId → CLASSIFIED + categoryId (일괄은 자동 학습 안 함 — 이질적 선택의 규칙 폭증 방지)
 *   - resolution → 중복 처리(NEW=유지, DUP_SAME=제외, DUP_CHANGED=자동반영, DUP_OVERWRITE=유지·덮어쓰기)
 * 보안: 서버에서 spaceId 스코프로만 갱신(클라이언트 id 신뢰 안 함).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { FinStagedResolution } from '@/generated/prisma/enums'

const RESOLUTIONS: FinStagedResolution[] = ['NEW', 'DUP_SAME', 'DUP_CHANGED', 'DUP_OVERWRITE']

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === 'string')
    : []
  if (ids.length === 0) return errorResponse('대상 행이 없습니다', 400)

  const data: {
    categoryId?: string
    classStatus?: 'CLASSIFIED'
    matchedRuleId?: string | null
    resolution?: FinStagedResolution
  } = {}

  if (typeof body?.categoryId === 'string' && body.categoryId) {
    const category = await prisma.finCategory.findFirst({
      where: { id: body.categoryId, spaceId },
      select: { id: true },
    })
    if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)
    data.categoryId = body.categoryId
    data.classStatus = 'CLASSIFIED'
    // 일괄 분류는 규칙 학습을 하지 않으므로 기존 규칙 힌트(matchedRuleId)를 정리한다.
    data.matchedRuleId = null
  }

  if (typeof body?.resolution === 'string') {
    if (!RESOLUTIONS.includes(body.resolution))
      return errorResponse('유효하지 않은 처리 값입니다', 400)
    data.resolution = body.resolution
  }

  if (Object.keys(data).length === 0) return errorResponse('변경할 내용이 없습니다', 400)

  const result = await prisma.finStagedRow.updateMany({
    where: { id: { in: ids }, spaceId },
    data,
  })

  return NextResponse.json({ updated: result.count })
}

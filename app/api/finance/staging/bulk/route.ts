/**
 * POST /api/finance/staging/bulk
 * 선택한 스테이징 행들을 일괄 처리한다.
 *   - categoryId → CLASSIFIED + categoryId (일괄은 자동 학습 안 함 — 이질적 선택의 규칙 폭증 방지)
 *   - resolution → 중복 처리(NEW=유지, DUP_SAME=제외, DUP_CHANGED=자동반영, DUP_OVERWRITE=유지·덮어쓰기)
 *   - memo → 일괄 메모 설정(동일 적요 자동 적용 시 분류와 함께 전파)
 *   - excludeFromAnalysis → 일괄 분석 제외 지정/해제(저장 처리 시 확정 거래로 이관)
 *   - action: 'delete' → 스테이징 행 물리 삭제(DRAFT 임포트 한정)
 * 보안: 서버에서 spaceId 스코프로만 갱신(클라이언트 id 신뢰 안 함).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeMemoInput } from '@/lib/finance/memo'
import type { FinStagedResolution } from '@/generated/prisma/enums'

const RESOLUTIONS: FinStagedResolution[] = ['NEW', 'DUP_SAME', 'DUP_CHANGED', 'DUP_OVERWRITE']

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance', { write: true })
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === 'string')
    : []
  if (ids.length === 0) return errorResponse('대상 행이 없습니다', 400)

  // ── 삭제 ── 저장 전 대기열에서만 제거(DRAFT 임포트 한정). 커밋 전이므로 스냅샷 무관.
  if (body?.action === 'delete') {
    const res = await prisma.finStagedRow.deleteMany({
      where: { id: { in: ids }, spaceId, import: { status: 'DRAFT' } },
    })
    return NextResponse.json({ deleted: res.count })
  }

  const data: {
    categoryId?: string
    classStatus?: 'CLASSIFIED'
    matchedRuleId?: string | null
    resolution?: FinStagedResolution
    memo?: string | null
    excludeFromAnalysis?: boolean
  } = {}

  if (typeof body?.categoryId === 'string' && body.categoryId) {
    const category = await prisma.finCategory.findFirst({
      where: { id: body.categoryId, spaceId },
      select: { id: true, type: true },
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
    // 단건 PATCH와 동일 — 「유지」는 저장 대상으로 올린다(staging/[id]/route.ts 주석 참조)
    if (body.resolution === 'DUP_OVERWRITE') data.classStatus = 'CLASSIFIED'
  }

  // 메모 — 명시 전달 시에만 포함(미전달이 기존 메모를 지우지 않도록)
  if (body?.memo !== undefined) {
    const m = normalizeMemoInput(body.memo)
    if (!m.ok) return errorResponse(m.error, 400)
    data.memo = m.value ?? null
  }

  // 분석 제외 — 저장 처리 시 확정 거래로 이관(staging/commit)
  if (typeof body?.excludeFromAnalysis === 'boolean')
    data.excludeFromAnalysis = body.excludeFromAnalysis

  if (Object.keys(data).length === 0) return errorResponse('변경할 내용이 없습니다', 400)

  const result = await prisma.finStagedRow.updateMany({
    where: { id: { in: ids }, spaceId },
    data,
  })

  return NextResponse.json({ updated: result.count })
}

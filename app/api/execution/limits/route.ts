import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET /api/execution/limits — 안전 제한 설정 조회 (없으면 기본값 생성)
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // upsert로 없으면 기본값 생성
  const limits = await prisma.safetyLimits.upsert({
    where: { workspaceId: workspace.id },
    create: { workspaceId: workspace.id },
    update: {},
  })

  return NextResponse.json(limits)
}

// PUT /api/execution/limits — 안전 제한 설정 업데이트
export async function PUT(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const body = await request.json()
  const { maxBidChangePct, maxKeywordsPerBatch, maxBudgetChangePct, requireApproval } = body as {
    maxBidChangePct?: number
    maxKeywordsPerBatch?: number
    maxBudgetChangePct?: number
    requireApproval?: boolean
  }

  // 숫자 필드 유효성 검증
  if (maxBidChangePct !== undefined && (typeof maxBidChangePct !== 'number' || maxBidChangePct < 0)) {
    return errorResponse('maxBidChangePct는 0 이상의 숫자여야 합니다', 400)
  }
  if (maxKeywordsPerBatch !== undefined && (typeof maxKeywordsPerBatch !== 'number' || maxKeywordsPerBatch < 1)) {
    return errorResponse('maxKeywordsPerBatch는 1 이상의 숫자여야 합니다', 400)
  }
  if (maxBudgetChangePct !== undefined && (typeof maxBudgetChangePct !== 'number' || maxBudgetChangePct < 0)) {
    return errorResponse('maxBudgetChangePct는 0 이상의 숫자여야 합니다', 400)
  }

  // upsert: 없으면 생성 + 업데이트 값 적용
  const data: Record<string, unknown> = {}
  if (maxBidChangePct !== undefined) data.maxBidChangePct = maxBidChangePct
  if (maxKeywordsPerBatch !== undefined) data.maxKeywordsPerBatch = maxKeywordsPerBatch
  if (maxBudgetChangePct !== undefined) data.maxBudgetChangePct = maxBudgetChangePct
  if (requireApproval !== undefined) data.requireApproval = requireApproval

  const limits = await prisma.safetyLimits.upsert({
    where: { workspaceId: workspace.id },
    create: { workspaceId: workspace.id, ...data },
    update: data,
  })

  return NextResponse.json(limits)
}

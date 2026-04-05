import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET /api/collection/schedule — 수집 스케줄 조회
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const schedule = await prisma.collectionSchedule.findUnique({
    where: { workspaceId: workspace.id },
  })

  return NextResponse.json({ schedule })
}

// PUT /api/collection/schedule — 수집 스케줄 생성/수정
export async function PUT(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  let body: {
    enabled?: boolean
    cronExpression?: string
    timezone?: string
  }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  const schedule = await prisma.collectionSchedule.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      enabled: body.enabled ?? true,
      cronExpression: body.cronExpression ?? '30 12 * * *',
      timezone: body.timezone ?? 'Asia/Seoul',
    },
    update: {
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.cronExpression !== undefined && { cronExpression: body.cronExpression }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
    },
  })

  return NextResponse.json({ schedule })
}

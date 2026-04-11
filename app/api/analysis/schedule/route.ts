// GET/PUT /api/analysis/schedule — 분석 자동 스케줄 관리

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// 스케줄 기본값
const DEFAULT_SCHEDULE = {
  enabled: false,
  intervalDays: 7,
  slackNotify: true,
  lastAnalyzedAt: null,
}

/** GET — 워크스페이스의 분석 스케줄 조회 */
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const schedule = await prisma.analysisSchedule.findUnique({
    where: { workspaceId: workspace.id },
  })

  if (!schedule) {
    return NextResponse.json({ schedule: DEFAULT_SCHEDULE })
  }

  return NextResponse.json({
    schedule: {
      enabled: schedule.enabled,
      intervalDays: schedule.intervalDays,
      analysisHour: schedule.analysisHour,
      triggerAfterCollection: schedule.triggerAfterCollection,
      slackNotify: schedule.slackNotify,
      lastAnalyzedAt: schedule.lastAnalyzedAt,
    },
  })
}

/** PUT — 분석 스케줄 생성/수정 (upsert) */
export async function PUT(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // 요청 바디 파싱
  let body: {
    enabled?: boolean
    intervalDays?: number
    analysisHour?: number | null
    triggerAfterCollection?: boolean
    slackNotify?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const { enabled, intervalDays, analysisHour, triggerAfterCollection, slackNotify } = body

  // intervalDays 유효성 검증
  if (intervalDays !== undefined && (intervalDays < 1 || intervalDays > 30)) {
    return errorResponse('intervalDays는 1~30 사이여야 합니다', 400)
  }

  // analysisHour 유효성 검증
  if (analysisHour !== undefined && analysisHour !== null && (analysisHour < 0 || analysisHour > 23)) {
    return errorResponse('analysisHour는 0~23 사이여야 합니다', 400)
  }

  const schedule = await prisma.analysisSchedule.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      enabled: enabled ?? DEFAULT_SCHEDULE.enabled,
      intervalDays: intervalDays ?? DEFAULT_SCHEDULE.intervalDays,
      analysisHour: analysisHour ?? null,
      triggerAfterCollection: triggerAfterCollection ?? false,
      slackNotify: slackNotify ?? DEFAULT_SCHEDULE.slackNotify,
    },
    update: {
      ...(enabled !== undefined && { enabled }),
      ...(intervalDays !== undefined && { intervalDays }),
      ...(analysisHour !== undefined && { analysisHour }),
      ...(triggerAfterCollection !== undefined && { triggerAfterCollection }),
      ...(slackNotify !== undefined && { slackNotify }),
    },
  })

  return NextResponse.json({
    schedule: {
      enabled: schedule.enabled,
      intervalDays: schedule.intervalDays,
      analysisHour: schedule.analysisHour,
      triggerAfterCollection: schedule.triggerAfterCollection,
      slackNotify: schedule.slackNotify,
      lastAnalyzedAt: schedule.lastAnalyzedAt,
    },
  })
}

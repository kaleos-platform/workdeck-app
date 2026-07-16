/**
 * /api/agent/settings — workdeck 에이전트(SpaceAgent) 활성화 상태 + 오늘 사용량 조회.
 *   GET   — isActive + 오늘(KST) AgentLlmUsage 요약(요청 수/한도, 토큰) + Slack 연결 요약.
 *   PATCH — { agentActive: boolean } SpaceAgent upsert.
 * (Slack 채널 목록·등록/해제는 /api/slack/channels 가 단일 소스 — 여기선 연결 요약만 노출.)
 * 전부 ADMIN 게이트.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse, assertRole, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { todayKst } from '@/lib/agent/llm/usage'

export const runtime = 'nodejs'

// usage.ts의 spaceDailyLimit()과 동일한 env·기본값(50) — 표시 전용이라 재계산.
function spaceDailyLimit(): number {
  const raw = Number(process.env.WORKDECK_AGENT_DAILY_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? raw : 50
}

async function requireAdminSpace() {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }
  const ctx = await resolveSpaceContext()
  if ('error' in ctx) return { error: ctx.error }
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return { error: roleError }
  return { spaceId: ctx.space.id }
}

export async function GET() {
  const ctx = await requireAdminSpace()
  if ('error' in ctx) return ctx.error

  const [agent, usage, installation] = await Promise.all([
    prisma.spaceAgent.findUnique({
      where: { spaceId: ctx.spaceId },
      select: { isActive: true },
    }),
    prisma.agentLlmUsage.findUnique({
      where: { spaceId_date: { spaceId: ctx.spaceId, date: todayKst() } },
      select: { requestCount: true, inputTokens: true, outputTokens: true },
    }),
    prisma.slackInstallation.findUnique({
      where: { spaceId: ctx.spaceId },
      select: { teamName: true, createdAt: true },
    }),
  ])

  return NextResponse.json({
    // 행이 없으면 기본값(활성) — SpaceAgent는 최초 비활성화 시에만 생성됨.
    agentActive: agent?.isActive ?? true,
    usage: {
      requestCount: usage?.requestCount ?? 0,
      dailyLimit: spaceDailyLimit(),
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    },
    slack: {
      installed: Boolean(installation),
      teamName: installation?.teamName ?? null,
      connectedAt: installation?.createdAt ?? null,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireAdminSpace()
  if ('error' in ctx) return ctx.error

  const body = (await req.json().catch(() => ({}))) as { agentActive?: unknown }
  if (typeof body.agentActive !== 'boolean') {
    return errorResponse('agentActive(boolean)는 필수입니다', 400)
  }

  const agent = await prisma.spaceAgent.upsert({
    where: { spaceId: ctx.spaceId },
    create: { spaceId: ctx.spaceId, isActive: body.agentActive },
    update: { isActive: body.agentActive },
    select: { isActive: true },
  })

  return NextResponse.json({ agentActive: agent.isActive })
}

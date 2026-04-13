import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// lastActiveAt이 3분 이내면 connected로 판단 (heartbeat 90초 간격 기준)
const CONNECTED_THRESHOLD_MS = 3 * 60 * 1000

function toAgentResponse(agent: {
  id: string
  slackChannelId: string | null
  isActive: boolean
  lastActiveAt: Date | null
}) {
  const connected =
    agent.lastActiveAt != null &&
    Date.now() - agent.lastActiveAt.getTime() < CONNECTED_THRESHOLD_MS

  return {
    id: agent.id,
    slackChannelId: agent.slackChannelId,
    enabled: agent.isActive,
    connected,
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
  }
}

// 에이전트 설정 조회
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const agent = await prisma.businessAgent.findUnique({
    where: { workspaceId: workspace.id },
  })

  if (!agent) return NextResponse.json({ agent: null })
  return NextResponse.json({ agent: toAgentResponse(agent) })
}

// 에이전트 설정 생성/업데이트
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const body = await request.json()
  // UI는 enabled를, 이전 호출자는 isActive를 보낼 수 있음
  const slackChannelId = body.slackChannelId ?? undefined
  const isActive = body.enabled ?? body.isActive ?? true

  const agent = await prisma.businessAgent.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      slackChannelId: slackChannelId || null,
      isActive,
    },
    update: {
      ...(slackChannelId !== undefined && { slackChannelId: slackChannelId || null }),
      isActive,
    },
  })

  return NextResponse.json(toAgentResponse(agent))
}

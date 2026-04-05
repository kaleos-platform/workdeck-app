import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth } from '@/lib/api-helpers'

// 에이전트 heartbeat — lastActiveAt 갱신 + 설정 반환
// Worker API Key로 인증 (x-worker-api-key 헤더)
export async function POST(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const body = await request.json()
  const { workspaceId } = body

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const agent = await prisma.businessAgent.findUnique({
    where: { workspaceId },
  })

  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  }

  // lastActiveAt 갱신
  await prisma.businessAgent.update({
    where: { workspaceId },
    data: { lastActiveAt: new Date() },
  })

  return NextResponse.json({
    slackChannelId: agent.slackChannelId,
    enabled: agent.isActive,
  })
}

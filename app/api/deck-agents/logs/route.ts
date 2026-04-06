import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, resolveWorkerAuth } from '@/lib/api-helpers'

// GET /api/deck-agents/logs — 에이전트 활동 로그 조회 (사용자 인증)
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const agent = await prisma.businessAgent.findUnique({
    where: { workspaceId: workspace.id },
    select: { id: true },
  })

  if (!agent) return NextResponse.json({ logs: [] })

  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10),
    50,
  )

  const logs = await prisma.agentLog.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({ logs })
}

// POST /api/deck-agents/logs — 에이전트 로그 기록 (Worker 인증)
export async function POST(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const body = await request.json()
  const { workspaceId, type, command, response, channel } = body

  if (!workspaceId || !type) {
    return NextResponse.json({ error: 'workspaceId and type are required' }, { status: 400 })
  }

  const agent = await prisma.businessAgent.findUnique({
    where: { workspaceId },
    select: { id: true },
  })

  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  }

  const log = await prisma.agentLog.create({
    data: {
      agentId: agent.id,
      type,
      command: command ?? null,
      response: response ?? null,
      channel: channel ?? null,
    },
  })

  return NextResponse.json({ log })
}

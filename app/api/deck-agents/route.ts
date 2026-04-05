import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// 에이전트 설정 조회
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const agent = await prisma.businessAgent.findUnique({
    where: { workspaceId: workspace.id },
  })

  return NextResponse.json({ agent })
}

// 에이전트 설정 생성/업데이트
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const body = await request.json()
  const { slackChannelId, isActive } = body

  const agent = await prisma.businessAgent.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      slackChannelId: slackChannelId || null,
      isActive: isActive ?? true,
    },
    update: {
      slackChannelId: slackChannelId || null,
      isActive: isActive ?? true,
    },
  })

  return NextResponse.json({ agent })
}

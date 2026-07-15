/**
 * /api/slack/channels — Space의 Slack 설치·승인 채널 현황 관리(전부 ADMIN).
 *   GET    — 설치 여부 + 등록된 채널 목록.
 *   POST   — { channelId, channelName? } 승인 채널(kind=approvals) upsert. 설치 없으면 400.
 *   DELETE — 승인 채널 제거.
 * (설정 UI는 M5 예약 — 지금은 API만.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse, assertRole, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

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

  const installation = await prisma.slackInstallation.findUnique({
    where: { spaceId: ctx.spaceId },
    select: { teamId: true, teamName: true, botUserId: true, scope: true, createdAt: true },
  })
  const channels = await prisma.spaceSlackChannel.findMany({
    where: { spaceId: ctx.spaceId },
    select: { id: true, channelId: true, channelName: true, kind: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ installed: Boolean(installation), installation, channels })
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSpace()
  if ('error' in ctx) return ctx.error

  const body = (await req.json().catch(() => ({}))) as {
    channelId?: string
    channelName?: string
  }
  const channelId = body.channelId?.trim()
  if (!channelId) return errorResponse('channelId는 필수입니다', 400)

  // 설치가 있어야 채널을 등록할 수 있다(FK: SpaceSlackChannel.spaceId → SlackInstallation.spaceId).
  const installation = await prisma.slackInstallation.findUnique({
    where: { spaceId: ctx.spaceId },
    select: { spaceId: true },
  })
  if (!installation) return errorResponse('Slack 설치가 없습니다. 먼저 연동을 완료하세요', 400)

  const channel = await prisma.spaceSlackChannel.upsert({
    where: { spaceId_kind: { spaceId: ctx.spaceId, kind: 'approvals' } },
    create: {
      spaceId: ctx.spaceId,
      channelId,
      channelName: body.channelName?.trim() || null,
      kind: 'approvals',
    },
    update: {
      channelId,
      channelName: body.channelName?.trim() || null,
    },
    select: { id: true, channelId: true, channelName: true, kind: true },
  })

  return NextResponse.json({ channel })
}

export async function DELETE() {
  const ctx = await requireAdminSpace()
  if ('error' in ctx) return ctx.error

  await prisma.spaceSlackChannel.deleteMany({
    where: { spaceId: ctx.spaceId, kind: 'approvals' },
  })

  return NextResponse.json({ ok: true })
}

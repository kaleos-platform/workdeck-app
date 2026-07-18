/**
 * /api/decks/notification-setting — Deck 단위 Slack 알림 토글 조회/변경.
 *  GET  ?deckKey=coupang-ads|seller-hub → { enabled, channelRegistered }
 *  PATCH { deckKey, enabled }           → { enabled }
 * 인증: resolveDeckContext(deckKey) + ADMIN 이상. deckKey는 화이트리스트로 제한한다.
 *
 * UI 계약(경로·필드명) 고정 — 프론트가 이 계약으로 병렬 개발 중이라 변경 금지.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, resolveDeckContext, assertRole } from '@/lib/api-helpers'
import { NOTIFICATION_CHANNEL_KIND } from '@/lib/slack/notification-target'

export const runtime = 'nodejs'

// 알림 토글을 지원하는 Deck — 이 외 deckKey는 400.
const ALLOWED_DECK_KEYS = new Set(['coupang-ads', 'seller-hub'])

async function channelRegistered(spaceId: string): Promise<boolean> {
  const channel = await prisma.spaceSlackChannel.findUnique({
    where: { spaceId_kind: { spaceId, kind: NOTIFICATION_CHANNEL_KIND } },
    select: { id: true },
  })
  return channel !== null
}

export async function GET(req: NextRequest) {
  const deckKey = req.nextUrl.searchParams.get('deckKey')
  if (!deckKey || !ALLOWED_DECK_KEYS.has(deckKey)) {
    return errorResponse('유효하지 않은 deckKey입니다', 400)
  }

  const ctx = await resolveDeckContext(deckKey)
  if ('error' in ctx) return ctx.error
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError

  const deckInstance = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId: ctx.space.id, deckAppId: deckKey } },
    select: { slackNotifyEnabled: true },
  })

  return NextResponse.json({
    enabled: deckInstance?.slackNotifyEnabled ?? true,
    channelRegistered: await channelRegistered(ctx.space.id),
  })
}

export async function PATCH(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  const { deckKey, enabled } = (body ?? {}) as { deckKey?: unknown; enabled?: unknown }
  if (typeof deckKey !== 'string' || !ALLOWED_DECK_KEYS.has(deckKey)) {
    return errorResponse('유효하지 않은 deckKey입니다', 400)
  }
  if (typeof enabled !== 'boolean') {
    return errorResponse('enabled는 boolean이어야 합니다', 400)
  }

  const ctx = await resolveDeckContext(deckKey)
  if ('error' in ctx) return ctx.error
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError

  const updated = await prisma.deckInstance.update({
    where: { spaceId_deckAppId: { spaceId: ctx.space.id, deckAppId: deckKey } },
    data: { slackNotifyEnabled: enabled },
    select: { slackNotifyEnabled: true },
  })

  return NextResponse.json({ enabled: updated.slackNotifyEnabled })
}

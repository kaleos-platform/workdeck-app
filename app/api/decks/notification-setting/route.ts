/**
 * /api/decks/notification-setting — Deck 단위 Slack 알림 토글 조회/변경.
 *  GET  ?deckKey=coupang-ads|seller-hub
 *       → { enabled, channelRegistered, events: [{ key, label, description, enabled }] }
 *  PATCH { deckKey, enabled?, events?: Record<string, boolean> }
 *       → { enabled, events: [{ key, label, description, enabled }] }
 * 인증: resolveDeckContext(deckKey) + ADMIN 이상. deckKey는 화이트리스트로 제한한다.
 *
 * events는 레지스트리(notification-events.ts)의 togglable 이벤트만 노출한다.
 * 저장 규약: 비활성 이벤트만 { "<eventKey>": false }. true는 키 삭제로 정규화(미기재=on).
 *
 * UI 계약(경로·필드명) 고정 — 프론트가 이 계약으로 병렬 개발 중이라 변경 금지.
 * 기존 필드(enabled/channelRegistered) 하위호환 유지.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { errorResponse, resolveDeckContext, assertRole } from '@/lib/api-helpers'
import { NOTIFICATION_CHANNEL_KIND } from '@/lib/slack/notification-target'
import { DECK_NOTIFICATION_EVENTS, findDeckEvent } from '@/lib/slack/notification-events'

export const runtime = 'nodejs'

// 알림 토글을 지원하는 Deck — 이 외 deckKey는 400.
const ALLOWED_DECK_KEYS = new Set(['coupang-ads', 'seller-hub'])

type StoredEvents = Record<string, boolean> | null

/**
 * 저장된 slackNotifyEvents(Json)를 UI 계약 형태의 events 배열로 만든다.
 * togglable 이벤트만 포함하고, enabled = 저장값이 false가 아닌 모든 경우(미기재=on).
 * GET/PATCH가 같은 형태를 반환하도록 단일 소스로 공유한다.
 */
function buildEventsArray(deckKey: string, stored: StoredEvents) {
  const events = DECK_NOTIFICATION_EVENTS[deckKey] ?? []
  return events
    .filter((e) => e.togglable)
    .map((e) => ({
      key: e.key,
      label: e.label,
      description: e.description,
      enabled: stored?.[e.key] !== false,
    }))
}

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
    select: { slackNotifyEnabled: true, slackNotifyEvents: true },
  })

  const stored = (deckInstance?.slackNotifyEvents ?? null) as StoredEvents
  return NextResponse.json({
    enabled: deckInstance?.slackNotifyEnabled ?? true,
    channelRegistered: await channelRegistered(ctx.space.id),
    events: buildEventsArray(deckKey, stored),
  })
}

export async function PATCH(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  const { deckKey, enabled, events } = (body ?? {}) as {
    deckKey?: unknown
    enabled?: unknown
    events?: unknown
  }
  if (typeof deckKey !== 'string' || !ALLOWED_DECK_KEYS.has(deckKey)) {
    return errorResponse('유효하지 않은 deckKey입니다', 400)
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return errorResponse('enabled는 boolean이어야 합니다', 400)
  }
  if (
    events !== undefined &&
    (typeof events !== 'object' || events === null || Array.isArray(events))
  ) {
    return errorResponse('events는 객체여야 합니다', 400)
  }
  if (enabled === undefined && events === undefined) {
    return errorResponse('enabled 또는 events 중 하나 이상이 필요합니다', 400)
  }

  // events 항목은 레지스트리상 togglable 이벤트여야 하고 값은 boolean이어야 한다.
  const eventEntries = events ? Object.entries(events as Record<string, unknown>) : []
  for (const [eventKey, value] of eventEntries) {
    const def = findDeckEvent(deckKey, eventKey)
    if (!def || !def.togglable) {
      return errorResponse(`유효하지 않은 eventKey입니다: ${eventKey}`, 400)
    }
    if (typeof value !== 'boolean') {
      return errorResponse(`events.${eventKey}는 boolean이어야 합니다`, 400)
    }
  }

  const ctx = await resolveDeckContext(deckKey)
  if ('error' in ctx) return ctx.error
  const roleError = assertRole(ctx.role, 'ADMIN')
  if (roleError) return roleError

  // events는 read-modify-write — 기존 Json에 머지하되 true는 키 삭제로 정규화(false만 저장).
  let nextEvents: StoredEvents = null
  if (events !== undefined) {
    const current = await prisma.deckInstance.findUnique({
      where: { spaceId_deckAppId: { spaceId: ctx.space.id, deckAppId: deckKey } },
      select: { slackNotifyEvents: true },
    })
    const merged: Record<string, boolean> = {
      ...((current?.slackNotifyEvents ?? {}) as Record<string, boolean>),
    }
    for (const [eventKey, value] of eventEntries) {
      if (value === false) merged[eventKey] = false
      else delete merged[eventKey]
    }
    nextEvents = Object.keys(merged).length > 0 ? merged : null
  }

  const updated = await prisma.deckInstance.update({
    where: { spaceId_deckAppId: { spaceId: ctx.space.id, deckAppId: deckKey } },
    data: {
      ...(enabled !== undefined ? { slackNotifyEnabled: enabled } : {}),
      ...(events !== undefined ? { slackNotifyEvents: nextEvents ?? Prisma.DbNull } : {}),
    },
    select: { slackNotifyEnabled: true, slackNotifyEvents: true },
  })

  return NextResponse.json({
    enabled: updated.slackNotifyEnabled,
    events: buildEventsArray(deckKey, (updated.slackNotifyEvents ?? null) as StoredEvents),
  })
}

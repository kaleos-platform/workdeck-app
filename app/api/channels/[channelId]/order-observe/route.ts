/** 채널의 주문 관측(그림자 수집) 설정 — 조회는 구성원, 저장은 ADMIN 이상. 읽기 전용 수집이라 외부 쓰기는 없다. */
import { NextRequest, NextResponse } from 'next/server'
import { assertRole, errorResponse, resolveAnyDeckContext } from '@/lib/api-helpers'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { ObserveSettingBodySchema, parseMatchRule } from '@/lib/channel-orders/types'

const DECKS = ['seller-hub', 'coupang-ads']

type SettingRow = {
  observeEnabled: boolean
  adapter: string
  storeKey: string | null
  reconcileMode: string
  matchKeyRule: unknown
}

const view = (s: SettingRow | null) => ({
  observeEnabled: s?.observeEnabled ?? false,
  adapter: s?.adapter ?? null,
  storeKey: s?.storeKey ?? null,
  reconcileMode: s?.reconcileMode ?? 'diagnose',
  matchKeyRule: s ? parseMatchRule(s.matchKeyRule) : null,
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(DECKS)
  if ('error' in resolved) return resolved.error
  const { channelId } = await params
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { fulfillmentSetting: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)
  return NextResponse.json({
    setting: view(channel.fulfillmentSetting),
    canEdit: assertRole(resolved.role, 'ADMIN') === null,
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const resolved = await resolveAnyDeckContext(DECKS)
  if ('error' in resolved) return resolved.error
  const denied = assertRole(resolved.role, 'ADMIN')
  if (denied) return denied
  const { channelId } = await params
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true, fulfillmentSetting: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)
  const parsed = ObserveSettingBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { observeEnabled, adapter, reconcileMode, matchKeyRule } = parsed.data
  const storeKey = adapter === 'naver' ? (parsed.data.storeKey ?? null) : null

  // 카페24 자격증명은 Space 단위라 두 채널이 같은 주문을 읽게 된다 — Space 당 관측 채널 1개만.
  // ponytail: 동시 PUT 경합은 막지 못한다(부분 유니크 인덱스는 Prisma 스키마로 표현 불가). 문제가 보이면 DB 인덱스로.
  if (adapter === 'cafe24' && observeEnabled) {
    const other = await prisma.channelFulfillmentSetting.findFirst({
      where: {
        spaceId: resolved.space.id,
        adapter: 'cafe24',
        observeEnabled: true,
        channelId: { not: channelId },
      },
      select: { channelId: true },
    })
    if (other) {
      return errorResponse(
        '카페24 주문 관측은 작업 공간당 채널 1개에만 켤 수 있습니다. 이미 켜진 채널의 관측을 끈 뒤 설정하세요.',
        409
      )
    }
  }

  const prev = channel.fulfillmentSetting
  // 어댑터·스토어가 바뀌면 이전 커서는 의미가 없다 — 다시 14일 backfill.
  const reset = prev && (prev.adapter !== adapter || prev.storeKey !== storeKey)
  const saved = await prisma.channelFulfillmentSetting.upsert({
    where: { channelId },
    create: {
      channelId,
      spaceId: resolved.space.id,
      adapter,
      storeKey,
      observeEnabled,
      ...(reconcileMode && { reconcileMode }),
      ...(matchKeyRule && { matchKeyRule }),
    },
    update: {
      adapter,
      storeKey,
      observeEnabled,
      ...(reconcileMode && { reconcileMode }),
      // undefined = 유지, null = 해제(대사에서 C), 객체 = 설정
      ...(matchKeyRule === null && { matchKeyRule: Prisma.DbNull }),
      ...(matchKeyRule && { matchKeyRule }),
      ...(reset && { observeCursor: Prisma.DbNull }),
    },
  })
  return NextResponse.json({ setting: view(saved) })
}

/** 채널의 주문 관측(그림자 수집) 설정 — 조회는 구성원, 저장은 ADMIN 이상. 읽기 전용 수집이라 외부 쓰기는 없다. */
import { NextRequest, NextResponse } from 'next/server'
import { assertRole, errorResponse, resolveAnyDeckContext } from '@/lib/api-helpers'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { MALL_ID_RE } from '@/lib/cafe24/client'
import { legacyMallId, listCafe24Malls } from '@/lib/cafe24/store'
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
  const storeKey = adapter === 'naver' || adapter === 'cafe24' ? parsed.data.storeKey || null : null
  if (adapter === 'cafe24' && storeKey && !MALL_ID_RE.test(storeKey)) {
    return errorResponse('입력값이 올바르지 않습니다', 400)
  }

  // 카페24는 쇼핑몰(storeKey = mallId)당 관측 채널 1개만 — 두 채널이 같은 주문을 읽지 않게. null storeKey 는 레거시 행의 mallId 로 해석한다.
  // ponytail: 동시 PUT 경합은 막지 못한다(부분 유니크 인덱스는 Prisma 스키마로 표현 불가). 문제가 보이면 DB 인덱스로.
  if (adapter === 'cafe24' && observeEnabled && storeKey) {
    const malls = await listCafe24Malls(resolved.space.id)
    if (!malls.some((m) => m.mallId === storeKey)) {
      return errorResponse('연결되지 않은 카페24 쇼핑몰입니다', 400)
    }
    const others = await prisma.channelFulfillmentSetting.findMany({
      where: {
        spaceId: resolved.space.id,
        adapter: 'cafe24',
        observeEnabled: true,
        channelId: { not: channelId },
      },
      select: { storeKey: true },
    })
    const legacyId = others.some((o) => o.storeKey === null)
      ? await legacyMallId(resolved.space.id)
      : null
    if (others.some((o) => (o.storeKey ?? legacyId) === storeKey)) {
      return errorResponse(
        '이 카페24 쇼핑몰은 이미 다른 채널에서 주문 관측 중입니다. 그 채널의 관측을 끈 뒤 설정하세요.',
        409
      )
    }
  }

  const prev = channel.fulfillmentSetting
  // 어댑터·스토어가 바뀌면 이전 커서는 의미가 없다 — 다시 14일 backfill.
  // 카페24 레거시 채널(storeKey null)은 레거시 몰과 같은 대상으로 본다 — 같은 몰을 다시 골라 저장해도 reset 하지 않는다.
  const prevKey =
    prev?.adapter === 'cafe24' && adapter === 'cafe24' && prev.storeKey === null
      ? await legacyMallId(resolved.space.id)
      : prev?.storeKey
  const reset = prev && (prev.adapter !== adapter || (prevKey ?? null) !== storeKey)
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
      // 진행 중이던 작업이 새 설정의 커서를 덮어쓰지 못하게 lease 도 비운다.
      ...(reset && { observeCursor: Prisma.DbNull, observeLease: Prisma.DbNull }),
    },
  })
  if (reset) {
    await prisma.pipelineOperation.updateMany({
      where: { channelId, status: 'STARTED' },
      data: { status: 'FAILED', error: 'setting_changed', finishedAt: new Date() },
    })
  }
  return NextResponse.json({ setting: view(saved) })
}

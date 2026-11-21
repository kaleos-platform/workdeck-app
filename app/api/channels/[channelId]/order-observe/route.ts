/** 채널의 주문 관측(그림자 수집) 설정 — 조회는 구성원, 저장은 ADMIN 이상. 읽기 전용 수집이라 외부 쓰기는 없다. */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { assertRole, errorResponse, resolveAnyDeckContext } from '@/lib/api-helpers'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { ADAPTERS } from '@/lib/channel-orders/types'

const DECKS = ['seller-hub', 'coupang-ads']

const BodySchema = z
  .object({
    observeEnabled: z.boolean(),
    adapter: z.enum(ADAPTERS),
    storeKey: z.string().trim().max(100).nullish(),
  })
  .refine((v) => v.adapter !== 'naver' || !v.observeEnabled || !!v.storeKey, {
    message: '네이버는 스토어 키가 필요합니다',
    path: ['storeKey'],
  })

const view = (s: { observeEnabled: boolean; adapter: string; storeKey: string | null } | null) => ({
  observeEnabled: s?.observeEnabled ?? false,
  adapter: s?.adapter ?? null,
  storeKey: s?.storeKey ?? null,
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
  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { observeEnabled, adapter } = parsed.data
  const storeKey = adapter === 'naver' ? (parsed.data.storeKey ?? null) : null

  const prev = channel.fulfillmentSetting
  // 어댑터·스토어가 바뀌면 이전 커서는 의미가 없다 — 다시 14일 backfill.
  const reset = prev && (prev.adapter !== adapter || prev.storeKey !== storeKey)
  const saved = await prisma.channelFulfillmentSetting.upsert({
    where: { channelId },
    create: { channelId, spaceId: resolved.space.id, adapter, storeKey, observeEnabled },
    update: {
      adapter,
      storeKey,
      observeEnabled,
      ...(reset && { observeCursor: Prisma.DbNull }),
    },
  })
  return NextResponse.json({ setting: view(saved) })
}

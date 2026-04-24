import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeAlias } from '@/lib/sh/product-matching'

/**
 * POST /api/sh/shipping/aliases/bulk-import
 *
 * body (JSON): { entries: Array<{
 *   channelId: string
 *   aliasName: string       // 원본 상품명 — normalize되어 저장
 *   type: 'listing' | 'option'
 *   targetId: string        // listingId 또는 optionId
 * }> }
 *
 * 다중 fulfillment(수동 입력) alias는 이 경로로 bulk import 지원 안 함 —
 * 개별 ProductMatchDialog의 수동 입력 탭 경로로 생성 후 alias 저장 체크
 *
 * 응답: { created, updated, skipped, errors: [{ row, message }] }
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const entries = Array.isArray(body?.entries) ? body.entries : []
  if (entries.length === 0) return errorResponse('entries 배열이 필요합니다', 400)
  if (entries.length > 5000) return errorResponse('한 번에 최대 5000건까지 가져올 수 있습니다', 400)

  // 채널 · listing · option 존재 여부 일괄 검증
  const channelIds = Array.from(
    new Set(entries.map((e: { channelId?: string }) => e.channelId).filter(Boolean) as string[])
  )
  const listingIds = Array.from(
    new Set(
      entries
        .filter((e: { type?: string }) => e.type === 'listing')
        .map((e: { targetId?: string }) => e.targetId)
        .filter(Boolean) as string[]
    )
  )
  const optionIds = Array.from(
    new Set(
      entries
        .filter((e: { type?: string }) => e.type === 'option')
        .map((e: { targetId?: string }) => e.targetId)
        .filter(Boolean) as string[]
    )
  )

  const [channels, listings, options] = await Promise.all([
    channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: channelIds }, spaceId: resolved.space.id },
          select: { id: true },
        })
      : Promise.resolve([]),
    listingIds.length
      ? prisma.productListing.findMany({
          where: { id: { in: listingIds }, spaceId: resolved.space.id },
          select: { id: true },
        })
      : Promise.resolve([]),
    optionIds.length
      ? prisma.invProductOption.findMany({
          where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
          select: { id: true },
        })
      : Promise.resolve([]),
  ])

  const validChannels = new Set(channels.map((c) => c.id))
  const validListings = new Set(listings.map((l) => l.id))
  const validOptions = new Set(options.map((o) => o.id))

  let created = 0
  let updated = 0
  let skipped = 0
  const errors: { row: number; message: string }[] = []

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const channelId = typeof e.channelId === 'string' ? e.channelId : ''
    const aliasNameRaw = typeof e.aliasName === 'string' ? e.aliasName : ''
    const type = e.type === 'listing' || e.type === 'option' ? e.type : null
    const targetId = typeof e.targetId === 'string' ? e.targetId : ''

    if (!channelId || !aliasNameRaw || !type || !targetId) {
      errors.push({ row: i + 1, message: '필수 필드 누락' })
      skipped++
      continue
    }
    if (!validChannels.has(channelId)) {
      errors.push({ row: i + 1, message: '채널을 찾을 수 없음' })
      skipped++
      continue
    }
    if (type === 'listing' && !validListings.has(targetId)) {
      errors.push({ row: i + 1, message: '판매채널 상품을 찾을 수 없음' })
      skipped++
      continue
    }
    if (type === 'option' && !validOptions.has(targetId)) {
      errors.push({ row: i + 1, message: '옵션을 찾을 수 없음' })
      skipped++
      continue
    }

    const aliasName = normalizeAlias(aliasNameRaw)
    if (!aliasName) {
      errors.push({ row: i + 1, message: 'aliasName이 비어있음' })
      skipped++
      continue
    }

    try {
      const existing = await prisma.channelProductAlias.findUnique({
        where: { channelId_aliasName: { channelId, aliasName } },
        select: { id: true },
      })
      if (existing) {
        await prisma.$transaction(async (tx) => {
          await tx.channelProductAlias.update({
            where: { id: existing.id },
            data: {
              listingId: type === 'listing' ? targetId : null,
              optionId: type === 'option' ? targetId : null,
            },
          })
          // 기존 다중 fulfillment가 있다면 제거 (단일 target으로 덮어씀)
          await tx.channelProductAliasFulfillment.deleteMany({ where: { aliasId: existing.id } })
        })
        updated++
      } else {
        await prisma.channelProductAlias.create({
          data: {
            spaceId: resolved.space.id,
            channelId,
            aliasName,
            listingId: type === 'listing' ? targetId : null,
            optionId: type === 'option' ? targetId : null,
          },
        })
        created++
      }
    } catch (err) {
      errors.push({
        row: i + 1,
        message: err instanceof Error ? err.message : '저장 실패',
      })
      skipped++
    }
  }

  return NextResponse.json({ created, updated, skipped, errors })
}

import { NextRequest } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/sh/shipping/aliases/export?channelId=<선택>
 *
 * ChannelProductAlias 전체(또는 특정 채널)를 CSV로 내보냅니다.
 * BOM 포함 UTF-8 — Excel에서 바로 열기 가능
 *
 * 컬럼:
 *   raw_name, channel_id, channel_name, target_type,
 *   listing_id, listing_name, option_id, option_name, product_name, fulfillments
 *
 * target_type: LISTING | OPTION | MANUAL
 * fulfillments (MANUAL only): optionId1:qty1|optionId2:qty2
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = new URL(req.url)
  const channelId = searchParams.get('channelId') ?? undefined

  const aliases = await prisma.channelProductAlias.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(channelId ? { channelId } : {}),
    },
    include: {
      channel: { select: { name: true } },
      listing: { select: { id: true, displayName: true, searchName: true } },
      option: {
        select: {
          id: true,
          name: true,
          product: { select: { name: true, internalName: true } },
        },
      },
      fulfillments: {
        include: { option: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ channelId: 'asc' }, { aliasName: 'asc' }],
  })

  const headers = [
    'raw_name',
    'channel_id',
    'channel_name',
    'target_type',
    'listing_id',
    'listing_name',
    'option_id',
    'option_name',
    'product_name',
    'fulfillments',
  ]

  const rows = aliases.map((a) => {
    // fulfillments 행이 있으면 MANUAL, 없으면 listingId 유무로 구분
    const targetType = a.fulfillments?.length > 0 ? 'MANUAL' : a.listingId ? 'LISTING' : 'OPTION'
    const fulfillmentsStr =
      a.fulfillments?.map((f) => `${f.optionId}:${f.quantity}`).join('|') ?? ''

    return [
      a.aliasName,
      a.channelId,
      a.channel.name,
      targetType,
      a.listingId ?? '',
      a.listing?.searchName ?? a.listing?.displayName ?? '',
      a.optionId ?? '',
      a.option?.name ?? '',
      a.option?.product ? (a.option.product.internalName ?? a.option.product.name) : '',
      fulfillmentsStr,
    ]
      .map(csvEscape)
      .join(',')
  })

  const csv = [headers.join(','), ...rows].join('\n')
  const today = new Date().toISOString().split('T')[0]

  // BOM(U+FEFF) 포함 — Excel UTF-8 인식
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="aliases-${today}.csv"`,
    },
  })
}

/** CSV 값 이스케이프 — 쉼표·따옴표·개행 포함 시 따옴표로 감쌈 */
function csvEscape(v: string | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

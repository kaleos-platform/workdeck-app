import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { computeListingAvailableStock } from '@/lib/sh/listing-calc'

// 홈 대시보드 "판매채널 재고" 카드 — 채널재고 vs 가용재고 불일치 3종.
//
// 가용재고(available) = 물리 재고(InvStockLevel)에서 파생되는 "만들 수 있는 세트 수".
// 채널재고(channelStock) = 판매채널에 올려둔 재고 캡 (null = 기능 미사용).
//
// 3 케이스 (channelStock != null 인 listing 만 평가):
//  1. 품절위험: channelStock <= 0 && available > 0  (가용은 충분한데 채널이 품절)
//  2. 가용부족·채널많음: available <= 0 && channelStock > 0  (채널엔 재고 있는데 실재고 없음 → 오버셀 위험)
//  3. 불일치: 둘 다 > 0 인데 값이 다름  (정합성 점검 필요)
//
// 무페이징 전체 스캔 — listing 수가 많은 space 에서 가장 무거운 read. channelStock != null
// 로 DB 선차감해 부담을 줄인다.

type IssueCase = 'channelSoldOut' | 'availableOut' | 'mismatch'

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  const listings = await prisma.productListing.findMany({
    where: { spaceId, channelStock: { not: null }, status: 'ACTIVE' },
    select: {
      id: true,
      searchName: true,
      managementName: true,
      channelStock: true,
      items: { select: { optionId: true, quantity: true } },
    },
  })

  if (listings.length === 0) {
    return NextResponse.json({
      channelSoldOutCount: 0,
      availableOutCount: 0,
      mismatchCount: 0,
      samples: [],
    })
  }

  // 옵션별 물리 재고 합산 (전체 위치)
  const optionIds = Array.from(new Set(listings.flatMap((l) => l.items.map((i) => i.optionId))))
  const stockMap = new Map<string, number>()
  if (optionIds.length > 0) {
    const stockRows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const row of stockRows) stockMap.set(row.optionId, row._sum.quantity ?? 0)
  }

  let channelSoldOutCount = 0
  let availableOutCount = 0
  let mismatchCount = 0
  const samples: Array<{
    listingId: string
    name: string
    channelStock: number
    availableStock: number
    case: IssueCase
  }> = []

  for (const l of listings) {
    const channelStock = l.channelStock ?? 0
    const available = computeListingAvailableStock(
      l.items.map((it) => ({ quantity: it.quantity, optionStock: stockMap.get(it.optionId) ?? 0 }))
    )

    let issue: IssueCase | null = null
    if (channelStock <= 0 && available > 0) {
      channelSoldOutCount += 1
      issue = 'channelSoldOut'
    } else if (available <= 0 && channelStock > 0) {
      availableOutCount += 1
      issue = 'availableOut'
    } else if (channelStock > 0 && available > 0 && channelStock !== available) {
      mismatchCount += 1
      issue = 'mismatch'
    }

    if (issue && samples.length < 5) {
      samples.push({
        listingId: l.id,
        name: l.managementName?.trim() || l.searchName,
        channelStock,
        availableStock: available,
        case: issue,
      })
    }
  }

  return NextResponse.json({
    channelSoldOutCount,
    availableOutCount,
    mismatchCount,
    samples,
  })
}

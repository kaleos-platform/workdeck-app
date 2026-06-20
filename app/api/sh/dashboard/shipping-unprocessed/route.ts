import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 홈 대시보드 "배송 미처리" 카드 — 방치된 배송 처리 케이스 (매출 미반영 위험).
//
// 2종 검출 (사용자 요청: 미처리 케이스 안내):
//  1. 오래된 DRAFT 배치: 생성 후 N일 지나도록 미완료 (기본 3일). 완료해야 매출 반영.
//  2. 매칭 실패 항목: DRAFT 배치의 주문 라인 중 optionId·listingId 모두 null (옵션 귀속 불가).
//
// "완료됐으나 재고 미차감" 검출은 의도적으로 제외 — MANUAL 완료는 InvMovement 를 만들지
// 않고, channelStock 미사용(null) 셀러는 ChannelStockMovement 도 없어 정상 배치를 전부
// 오탐한다 (batches/[batchId] 완료 경로 확인). 재고 정합성 점검은 채널재고 카드가 담당.

const STALE_DRAFT_DAYS = 3

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  const staleCutoff = new Date()
  staleCutoff.setDate(staleCutoff.getDate() - STALE_DRAFT_DAYS)

  const [staleDraftBatchCount, unmatchedItemCount] = await Promise.all([
    // 1. 오래된 DRAFT 배치
    prisma.delBatch.count({
      where: { spaceId, status: 'DRAFT', createdAt: { lt: staleCutoff } },
    }),
    // 2. 매칭 실패 항목 (DRAFT 배치 소속, 옵션·listing 둘 다 null)
    prisma.delOrderItem.count({
      where: {
        optionId: null,
        listingId: null,
        order: { spaceId, batch: { status: 'DRAFT' } },
      },
    }),
  ])

  return NextResponse.json({
    staleDraftBatchCount,
    unmatchedItemCount,
    staleDraftDays: STALE_DRAFT_DAYS,
  })
}

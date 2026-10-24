/** POST — 워커가 Naver 에서 받아온 하루치 상품주문을 적재한다(해당 일 배치 재생성). */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { NaverProductOrderSchema } from '@/lib/naver-commerce/client'
import { ensureNbaesongChannel } from '@/lib/naver-commerce/nbaesong-channel'
import { syncNbaesongDay } from '@/lib/naver-commerce/nbaesong-sync'
import { loadNbaesongStore, resolveNbaesongScope } from '@/lib/naver-commerce/worker-api'

const BodySchema = z.object({
  spaceId: z.string().min(1),
  storeKey: z.string().min(1),
  dayKst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orders: z.array(NaverProductOrderSchema).max(2000),
})

export async function POST(request: NextRequest) {
  const resolved = await resolveNbaesongScope(request.headers)
  if ('error' in resolved) return resolved.error
  const { scope } = resolved
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { spaceId, storeKey, dayKst, orders } = parsed.data

  const found = await loadNbaesongStore(scope, spaceId, storeKey)
  if (found.error) return found.error
  const { config, store } = found

  const channelId = await ensureNbaesongChannel({
    spaceId,
    storeKey,
    label: store.label,
    representativeChannelId: store.representativeChannelId,
  })
  const result = await syncNbaesongDay({
    spaceId,
    storeKey,
    channelId,
    locationId: config.locationId,
    representativeChannelId: store.representativeChannelId,
    dayKst,
    orders,
  })
  return NextResponse.json(result)
}

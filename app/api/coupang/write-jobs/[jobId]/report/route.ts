/**
 * POST /api/coupang/write-jobs/[jobId]/report — 워커 전용. 잡 결과 보고.
 * 성공한 PRICE_CHANGE 타깃은 CoupangProductItem 스냅샷 가격을 즉시 갱신해
 * 다음 미리보기가 낡은 가격을 보여주지 않게 한다. MP 축 성공 타깃은 워크덱 판매가(ProductListing.retailPrice)도 갱신한다(v1.1 D4).
 *
 * RUNNING 상태일 때만 갱신한다(updateMany 게이트) — reap cron 이 먼저 stale 회수해
 * PENDING/FAILED 로 돌려놓은 뒤 원래 워커의 뒤늦은 보고가 도착하면, 그 보고로 최신
 * 상태(재시도 결과일 수도 있는)를 덮어쓰면 안 된다. count=0 이면 stale 응답만 주고
 * 아무것도 건드리지 않는다(스냅샷 갱신 포함).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { resolveCollectionAuth } from '@/lib/collection/resolve-workspace'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = await resolveCollectionAuth(request)
  if ('error' in auth) return auth.error
  // claim 과 같은 축 — 워커 전용 + workspaceId 스코프. 워커가 잘못된 환경을 가리키면
  // 다른 워크스페이스 잡을 보고해 덮어쓸 수 있다.
  if (auth.kind !== 'worker') {
    return errorResponse('워커 전용 엔드포인트입니다', 401)
  }

  const { jobId } = await ctx.params
  const body = (await request.json()) as {
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
    results?: Array<{ listingId: string; vendorItemId: string; ok: boolean; error: string | null }>
    error?: string
  }
  if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(body.status)) {
    return errorResponse(`알 수 없는 status: ${String(body.status)}`, 400)
  }

  // 상태 게이트와 가격 갱신을 한 트랜잭션에 — 결과만 기록되고 가격 갱신이 빠지는 일이 없게(v1.1 D4).
  const applied = await prisma.$transaction(async (tx) => {
    const gate = await tx.coupangWriteJob.updateMany({
      where: { id: jobId, status: 'RUNNING', workspaceId: auth.workspaceId },
      data: {
        status: body.status,
        results: (body.results ?? []) as unknown as object,
        error: body.error ?? null,
        executedAt: new Date(),
      },
    })
    if (gate.count !== 1) return false

    const job = await tx.coupangWriteJob.findUniqueOrThrow({ where: { id: jobId } })
    if (job.kind !== 'PRICE_CHANGE' || !body.results?.length) return true

    const payload = job.payload as {
      channelAxis: 'RG' | 'MP'
      targets: Array<{ listingId: string; vendorItemId: string; targetPrice: number }>
    }
    for (const r of body.results) {
      if (!r.ok) continue
      // 잡이 만든 타깃과 listingId·vendorItemId 가 모두 맞는 보고만 믿는다.
      const t = payload.targets.find((x) => x.listingId === r.listingId && x.vendorItemId === r.vendorItemId)
      if (!t) continue
      // 스냅샷은 실제로 가격이 바뀐 쿠팡 옵션(vendorItemId) 기준 — 잡 생성 후 리스팅 재연결이
      // 있었어도 다른 옵션의 스냅샷에 가격이 찍히지 않는다.
      await tx.coupangProductItem.updateMany({
        where:
          payload.channelAxis === 'RG'
            ? { spaceId: job.spaceId, rgVendorItemId: r.vendorItemId }
            : { spaceId: job.spaceId, mpVendorItemId: r.vendorItemId },
        data: payload.channelAxis === 'RG' ? { rgSalePrice: t.targetPrice } : { mpSalePrice: t.targetPrice },
      })
      // 워크덱 리스팅은 판매자배송 채널에 1개이고 로켓그로스는 그것을 미러링한다.
      // 쿠팡 가격 2개 중 리스팅 판매가로 맞출 수 있는 건 MP 축뿐이다(RG 가격은 쿠팡에만 존재).
      if (payload.channelAxis === 'MP') {
        await tx.productListing.updateMany({
          where: { id: t.listingId, spaceId: job.spaceId },
          data: { retailPrice: t.targetPrice },
        })
      }
    }
    return true
  })
  if (!applied) return NextResponse.json({ ok: false, stale: true })

  return NextResponse.json({ ok: true })
}

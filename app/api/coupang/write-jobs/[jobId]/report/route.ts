/**
 * POST /api/coupang/write-jobs/[jobId]/report — 워커 전용. 잡 결과 보고.
 * 성공한 PRICE_CHANGE 타깃은 CoupangProductItem 스냅샷 가격을 즉시 갱신해
 * 다음 미리보기가 낡은 가격을 보여주지 않게 한다. Slack 알림까지 여기서 체이닝한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkerAuth } from '@/lib/api-helpers'
import { notifyWriteJobResult } from '@/lib/slack/notify-write-job-result'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const { jobId } = await ctx.params
  const body = (await request.json()) as {
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
    results?: Array<{ listingId: string; vendorItemId: string; ok: boolean; error: string | null }>
    error?: string
  }

  const job = await prisma.coupangWriteJob.update({
    where: { id: jobId },
    data: {
      status: body.status,
      results: (body.results ?? []) as unknown as object,
      error: body.error ?? null,
      executedAt: new Date(),
    },
  })

  // 성공한 타깃의 스냅샷 가격을 즉시 갱신해 미리보기가 낡지 않게 한다.
  if (job.kind === 'PRICE_CHANGE' && body.results?.length) {
    const payload = job.payload as {
      channelAxis: 'RG' | 'MP'
      targets: Array<{ listingId: string; targetPrice: number }>
    }
    for (const r of body.results.filter((x) => x.ok)) {
      const target = payload.targets.find((t) => t.listingId === r.listingId)
      if (!target) continue
      await prisma.coupangProductItem.updateMany({
        where: { spaceId: job.spaceId, listingId: r.listingId },
        data:
          payload.channelAxis === 'RG'
            ? { rgSalePrice: target.targetPrice }
            : { mpSalePrice: target.targetPrice },
      })
    }
  }

  await notifyWriteJobResult(jobId)
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { assertRole, errorResponse, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { requireCoupangWorkspaceId } from '@/lib/coupang/workspace-space'
import { computePriceTargets, priceInputSchema } from '@/lib/sh/coupang-price/compute-targets'

/**
 * POST /api/sh/coupang-price/apply — 승인 없이 쿠팡 가격 반영 잡을 만든다(v1.1 D1).
 * 요청자=승인자=1인 운영이라 미리보기 확인이 곧 승인이다. 대신 API 가 직접
 * ADMIN 역할을 요구한다(승인 채널 구성으로 대신하던 역할 게이트).
 * 실제 쿠팡 호출은 IP allowlist 때문에 워커가 한다 — 여기서는 잡만 만든다.
 */
// 미리보기에서 사용자가 본 반영 대상. 생략하면 검사하지 않는다(미리보기 스키마와 분리).
const applyInputSchema = priceInputSchema.extend({
  expectedListingIds: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error
  const denied = assertRole(resolved.role, 'ADMIN')
  if (denied) return denied

  const parsed = applyInputSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const spaceId = resolved.space.id

  // 클라이언트가 보낸 타깃을 믿지 않는다 — 미리보기와 같은 함수로 다시 계산.
  const computed = await computePriceTargets(spaceId, parsed.data)
  if ('error' in computed) return errorResponse(computed.error, computed.status)
  const writable = computed.targets.filter(
    (t): t is typeof t & { vendorItemId: string } =>
      t.blockedReason == null && t.vendorItemId != null
  )
  // 미리보기 이후 다른 탭에서 매칭이 확정·해제되면 사용자가 본 대상과 달라진다. 0개 검사보다
  // 먼저 해야 '본 대상이 전부 사라진' 경우도 미리보기 재로딩으로 이어진다.
  const expected = parsed.data.expectedListingIds
  if (expected) {
    const want = new Set(expected)
    const drifted = want.size !== writable.length || writable.some((t) => !want.has(t.listingId))
    if (drifted) {
      return errorResponse(
        '미리보기 이후 반영 대상이 바뀌었습니다. 미리보기를 다시 불러온 뒤 시도하세요',
        409,
        { code: 'TARGETS_CHANGED' }
      )
    }
  }

  if (writable.length === 0) return errorResponse('반영 가능한 대상이 없습니다', 400)

  let workspaceId: string
  try {
    workspaceId = await requireCoupangWorkspaceId(spaceId)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : '쿠팡 연동이 없습니다', 400)
  }

  // ponytail: check-then-create 라 동시 두 요청이 둘 다 통과할 수 있다. 가격 PUT 은
  // 자연 멱등이라 결과는 같고 잡만 하나 더 생긴다. 막으려면 부분 unique 인덱스.
  const running = await prisma.coupangWriteJob.findFirst({
    where: { spaceId, kind: 'PRICE_CHANGE', status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  })
  if (running) {
    return errorResponse('진행 중인 쿠팡 가격 반영이 있습니다. 끝난 뒤 다시 시도하세요', 409, {
      jobId: running.id,
    })
  }

  const job = await prisma.coupangWriteJob.create({
    data: {
      workspaceId,
      spaceId,
      kind: 'PRICE_CHANGE',
      payload: {
        channelAxis: computed.channelAxis,
        channelId: computed.channelId,
        // v1.1 D3 — 사용자는 주력 상품 자동조정을 전부 켜고 운영한다. 현재 상태를 읽을
        // API 가 없고 apMinSalePrice 와 함께 보내야 하므로 항상 켠다.
        apActive: true,
        targets: writable.map((t) => ({
          listingId: t.listingId,
          vendorItemId: t.vendorItemId,
          listingName: t.listingName,
          currentPrice: t.currentPrice,
          targetPrice: t.targetPrice,
          apMinSalePrice: t.apMinSalePrice,
        })),
      },
    },
    select: { id: true },
  })

  return NextResponse.json({ job: { id: job.id, targets: writable.length } }, { status: 201 })
}

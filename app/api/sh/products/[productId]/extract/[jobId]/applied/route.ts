// 클라이언트가 apply/route.ts 응답의 values 를 폼 state 에 반영하고, 그 폼의 기존 autosave
// PATCH 가 실제로 성공한 뒤에만 호출한다. appliedBefore 스냅샷은 apply 단계에서 이미
// 잡 row 에 저장돼 있으므로(그 시점 이후엔 InvProduct 가 바뀌어 다시 읽을 수 없다 — apply
// route 상단 주석 참고), 여기서는 appliedAt 만 확정 스탬프로 찍는다.
// 멱등: appliedAt 이 이미 있으면 그대로 반환 — 재호출이 appliedBefore 를 최초 스냅샷에서
// 다른 값으로 덮어쓰지 못하게 한다.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productExtractAppliedSchema } from '@/lib/sh/schemas'

type Params = { params: Promise<{ productId: string; jobId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, jobId } = await params

  const job = await prisma.productExtractionJob.findFirst({
    where: { id: jobId, productId, spaceId: resolved.space.id },
  })
  if (!job) return errorResponse('작업을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = productExtractAppliedSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  if (job.appliedAt && !job.rolledBackAt) {
    // 이미 확정된 잡 — 멱등하게 현재 상태를 그대로 반환.
    return NextResponse.json({ job })
  }

  const updated = await prisma.productExtractionJob.update({
    where: { id: jobId },
    data: {
      appliedAt: new Date(),
      // 롤백 후 재적용이면 롤백 표시를 지운다 — 남겨두면 이력이 "적용됨이자 롤백됨"이라는
      // 모순된 상태로 보이고, 화면이 다시 읽기 전용으로 잠긴다.
      rolledBackAt: null,
      // apply 단계에서 이미 저장했을 수 있지만, apply 를 거치지 않고 곧장 호출된 방어적
      // 케이스를 위해 비어있으면 요청 본문의 fields 로라도 채운다.
      appliedFields: job.appliedFields ?? parsed.data.fields,
    },
  })

  return NextResponse.json({ job: updated })
}

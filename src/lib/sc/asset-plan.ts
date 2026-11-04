// 사진 대기(AWAITING_ASSETS) 배포의 사진 자리 저장·완료. 완료하면 게시본에 사진을 넣고 바로 발행 작업을 만든다.

import { prisma } from '@/lib/prisma'
import {
  applyAssetPlan,
  photoSlots,
  type AssetPlan,
  type PublishSnapshot,
} from '@/lib/sc/aside-publish'

export type AssetPlanResult =
  | { ok: true; jobId?: string }
  | { ok: false; status: 400 | 404 | 409; message: string }

/** 이 콘텐츠에 올린 이미지만 쓸 수 있다(다른 콘텐츠·Space 의 에셋이나 외부 URL 금지). */
async function contentImageIds(contentId: string): Promise<Set<string>> {
  const assets = await prisma.contentAsset.findMany({
    where: { contentId, kind: 'IMAGE', storagePath: { not: null }, mimeType: { startsWith: 'image/' } },
    select: { id: true },
  })
  return new Set(assets.map((a) => a.id))
}

function knownIndexes(plan: AssetPlan, snapshot: PublishSnapshot): string | null {
  const valid = new Set(photoSlots(snapshot).map((s) => s.index))
  const bad = plan.slots.find((s) => !valid.has(s.index))
  return bad ? `없는 사진 자리입니다(${bad.index + 1}번)` : null
}

export async function saveAssetPlan(input: {
  spaceId: string
  deploymentId: string
  plan: AssetPlan
  complete: boolean
}): Promise<AssetPlanResult> {
  const { spaceId, deploymentId, plan } = input
  return prisma.$transaction(async (tx): Promise<AssetPlanResult> => {
    // 같은 배포를 두 번 완료해 발행 작업이 둘 생기지 않게 행을 잠근다.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ContentDeployment"
      WHERE "id" = ${deploymentId} AND "spaceId" = ${spaceId} FOR UPDATE`
    if (locked.length === 0) return { ok: false, status: 404, message: '배포를 찾을 수 없습니다' }
    const d = await tx.contentDeployment.findUnique({
      where: { id: deploymentId },
      select: { status: true, contentId: true, publishSnapshot: true, scheduledAt: true },
    })
    if (!d || d.status !== 'AWAITING_ASSETS' || !d.publishSnapshot) {
      return { ok: false, status: 409, message: '사진 등록을 기다리는 배포가 아닙니다' }
    }
    const snapshot = d.publishSnapshot as unknown as PublishSnapshot
    const badIndex = knownIndexes(plan, snapshot)
    if (badIndex) return { ok: false, status: 400, message: badIndex }

    const allowed = await contentImageIds(d.contentId)
    const foreign = plan.slots.find((s) => s.assetId && !allowed.has(s.assetId))
    if (foreign) return { ok: false, status: 400, message: '이 콘텐츠에 올린 사진만 쓸 수 있습니다' }

    if (!input.complete) {
      await tx.contentDeployment.update({
        where: { id: deploymentId },
        data: { assetPlan: plan as never },
      })
      return { ok: true }
    }

    const applied = applyAssetPlan(snapshot, plan, allowed)
    if (!applied.ok) return { ok: false, status: 400, message: applied.message }

    const now = new Date()
    const scheduledAt = d.scheduledAt && d.scheduledAt > now ? d.scheduledAt : now
    await tx.contentDeployment.update({
      where: { id: deploymentId },
      data: {
        assetPlan: plan as never,
        publishSnapshot: applied.snapshot as never,
        status: 'PUBLISHING',
        errorMessage: null,
      },
    })
    const job = await tx.salesContentJob.create({
      data: {
        spaceId,
        kind: 'PUBLISH',
        targetId: deploymentId,
        payload: { deploymentId },
        scheduledAt,
      },
      select: { id: true },
    })
    return { ok: true, jobId: job.id }
  })
}

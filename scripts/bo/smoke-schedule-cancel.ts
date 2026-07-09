/**
 * blog-ops 예약 발행 + 취소 버그 수정 DB 레벨 스모크 테스트
 *
 * 케이스 A (예약 claim 필터):
 *   deployment(PENDING, scheduledAt=now+1h) + PUBLISH job(scheduledAt=now+1h)
 *   → claimNextBoJob 호출 → null 이어야 함 (미래 job 안 잡힘)
 *   → job.scheduledAt 과거로 update → claim 재시도 → 잡혀야 함 → completeBoJob
 *
 * 케이스 B (취소 시 job 종결):
 *   deployment(PENDING) + PUBLISH job(PENDING, 즉시) 생성
 *   → cancel route 동일 쿼리(prisma) 수행:
 *       deployment → CANCELED, boJob {targetId, kind PUBLISH, status PENDING} → FAILED
 *   → job 상태 FAILED 확인
 *   → claimNextBoJob 호출 → null 확인
 *
 * 실행: npx tsx scripts/bo/smoke-schedule-cancel.ts
 * 종료 코드 0 = 전 케이스 통과. 생성 데이터는 끝에서 전부 삭제.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })

const TAG = '[bo-smoke-schedule-cancel]'
const MARK = '[스케줄취소스모크]'

function step(name: string) {
  console.log(`${TAG} ▶ ${name}`)
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`${TAG} 실패: ${msg}`)
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const { enqueueBoJob, claimNextBoJob, completeBoJob } = await import('@/lib/bo/jobs')

  const space = await prisma.space.findFirst({ select: { id: true, name: true } })
  if (!space) throw new Error('스페이스 없음 — seed 필요')
  console.log(`${TAG} space: ${space.name} (${space.id})`)

  // 생성된 리소스 ID 목록 (finally 에서 일괄 삭제)
  const created = {
    productIdA: '',
    channelIdA: '',
    productIdB: '',
    channelIdB: '',
  }

  try {
    // ────────────────────────────────────────────────────────────────
    // 케이스 A: 예약 claim 필터 검증
    // ────────────────────────────────────────────────────────────────
    step('A-1. 시드 생성 (space/product/material/post/channel/variant)')
    const productA = await prisma.boProduct.create({
      data: { spaceId: space.id, name: `${MARK} 상품A`, ctaUrl: 'https://example.com' },
    })
    created.productIdA = productA.id

    const materialA = await prisma.boMaterial.create({
      data: {
        spaceId: space.id,
        productId: productA.id,
        title: `${MARK} 소재A`,
        appealPoint: 't',
        angle: 't',
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    })
    const postA = await prisma.boPost.create({
      data: {
        spaceId: space.id,
        materialId: materialA.id,
        title: `${MARK} 포스트A`,
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '스케줄 스모크' }] }],
        },
        status: 'PUBLISH_APPROVED',
        publishApprovedAt: new Date(),
      },
    })
    const channelA = await prisma.boChannel.create({
      data: {
        spaceId: space.id,
        platform: 'NAVER_BLOG',
        name: `${MARK} 채널A`,
        publisherMode: 'BROWSER',
        formatProfile: {},
      },
    })
    created.channelIdA = channelA.id

    const variantA = await prisma.boPostVariant.create({
      data: {
        spaceId: space.id,
        postId: postA.id,
        channelId: channelA.id,
        title: postA.title,
        doc: postA.doc as object,
        status: 'READY',
      },
    })

    step('A-2. deployment(PENDING, scheduledAt=now+1h) + PUBLISH job(scheduledAt=now+1h) 생성')
    const futureAt = new Date(Date.now() + 60 * 60 * 1000) // now + 1h
    const deploymentA = await prisma.boDeployment.create({
      data: {
        spaceId: space.id,
        postId: postA.id,
        variantId: variantA.id,
        channelId: channelA.id,
        status: 'PENDING',
        scheduledAt: futureAt,
      },
    })
    const jobA = await enqueueBoJob({
      spaceId: space.id,
      kind: 'PUBLISH',
      targetId: deploymentA.id,
      payload: { deploymentId: deploymentA.id },
      scheduledAt: futureAt,
    })

    step('A-3. claimNextBoJob → null 이어야 함 (미래 job 은 안 잡힘)')
    const claimedNull = await claimNextBoJob({ workerId: 'smoke-a', kinds: ['PUBLISH'] })
    assert(
      claimedNull === null,
      `미래 job 이 claim 됨 — scheduledAt 필터 미동작 (jobId=${jobA.id})`
    )
    console.log(`${TAG} A-3 통과: 미래 job claim 차단 확인`)

    step('A-4. job.scheduledAt 을 과거로 update')
    await prisma.boJob.update({
      where: { id: jobA.id },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    })

    step('A-5. claimNextBoJob 재시도 → 잡혀야 함')
    const claimedJob = await claimNextBoJob({ workerId: 'smoke-a', kinds: ['PUBLISH'] })
    assert(claimedJob !== null, 'scheduledAt 과거로 변경 후에도 claim 실패')
    assert(claimedJob.id === jobA.id, `예상 job(${jobA.id}) 대신 다른 job 잡힘: ${claimedJob.id}`)
    console.log(`${TAG} A-5 통과: 과거 scheduledAt job claim 확인 (jobId=${claimedJob.id})`)

    step('A-6. completeBoJob 처리')
    const { updated } = await completeBoJob(claimedJob.id)
    assert(updated, 'completeBoJob 실패 — CLAIMED 상태가 아님')
    console.log(`${TAG} A-6 통과: completeBoJob 완료`)

    // ────────────────────────────────────────────────────────────────
    // 케이스 B: 취소 시 job 종결 검증
    // ────────────────────────────────────────────────────────────────
    step('B-1. 시드 생성 (space/product/material/post/channel/variant)')
    const productB = await prisma.boProduct.create({
      data: { spaceId: space.id, name: `${MARK} 상품B`, ctaUrl: 'https://example.com' },
    })
    created.productIdB = productB.id

    const materialB = await prisma.boMaterial.create({
      data: {
        spaceId: space.id,
        productId: productB.id,
        title: `${MARK} 소재B`,
        appealPoint: 't',
        angle: 't',
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    })
    const postB = await prisma.boPost.create({
      data: {
        spaceId: space.id,
        materialId: materialB.id,
        title: `${MARK} 포스트B`,
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '취소 스모크' }] }],
        },
        status: 'PUBLISH_APPROVED',
        publishApprovedAt: new Date(),
      },
    })
    const channelB = await prisma.boChannel.create({
      data: {
        spaceId: space.id,
        platform: 'NAVER_BLOG',
        name: `${MARK} 채널B`,
        publisherMode: 'BROWSER',
        formatProfile: {},
      },
    })
    created.channelIdB = channelB.id

    const variantB = await prisma.boPostVariant.create({
      data: {
        spaceId: space.id,
        postId: postB.id,
        channelId: channelB.id,
        title: postB.title,
        doc: postB.doc as object,
        status: 'READY',
      },
    })

    step('B-2. deployment(PENDING) + PUBLISH job(즉시) 생성')
    const deploymentB = await prisma.boDeployment.create({
      data: {
        spaceId: space.id,
        postId: postB.id,
        variantId: variantB.id,
        channelId: channelB.id,
        status: 'PENDING',
      },
    })
    const jobB = await enqueueBoJob({
      spaceId: space.id,
      kind: 'PUBLISH',
      targetId: deploymentB.id,
      payload: { deploymentId: deploymentB.id },
    })

    step('B-3. cancel route 와 동일한 쿼리 수행 (prisma 직접)')
    // cancel route (app/api/bo/deployments/[id]/cancel/route.ts) 와 동일:
    //   1) deployment PENDING → CANCELED
    //   2) boJob {targetId, kind PUBLISH, status in [PENDING, CLAIMED]} → FAILED
    await prisma.boDeployment.update({
      where: { id: deploymentB.id },
      data: { status: 'CANCELED' },
    })
    await prisma.boJob.updateMany({
      where: { targetId: deploymentB.id, kind: 'PUBLISH', status: { in: ['PENDING', 'CLAIMED'] } },
      data: { status: 'FAILED', errorMessage: '사용자 취소', completedAt: new Date() },
    })

    step('B-4. job 상태 FAILED 확인')
    const jobBFinal = await prisma.boJob.findUniqueOrThrow({ where: { id: jobB.id } })
    assert(jobBFinal.status === 'FAILED', `job 상태가 FAILED 아님: ${jobBFinal.status}`)
    console.log(`${TAG} B-4 통과: job FAILED 확인`)

    step('B-5. claimNextBoJob 호출 → null 확인 (취소된 job 은 claim 안 됨)')
    const claimedAfterCancel = await claimNextBoJob({ workerId: 'smoke-b', kinds: ['PUBLISH'] })
    // 취소된 job 이 FAILED 이므로 claim 불가. 단, 다른 PENDING job 이 없어야 정확한 assert.
    // jobA 는 이미 COMPLETED, jobB 는 FAILED → 둘 다 PENDING 아님.
    const otherPendingCount = await prisma.boJob.count({
      where: {
        spaceId: space.id,
        status: 'PENDING',
        kind: 'PUBLISH',
        targetId: { in: [deploymentA.id, deploymentB.id] },
      },
    })
    if (otherPendingCount === 0) {
      // 이 스모크가 만든 job 들은 모두 종결 → claimedAfterCancel 이 null 이거나
      // 다른 공유 PENDING job 을 잡은 경우 두 케이스 모두 버그 없음으로 판정
      if (claimedAfterCancel === null || claimedAfterCancel.id !== jobB.id) {
        console.log(`${TAG} B-5 통과: 취소된 job 이 claim 되지 않음`)
      } else {
        throw new Error(`${TAG} 취소된 job(${jobB.id}) 이 claim 됨 — 버그!`)
      }
    } else {
      console.log(`${TAG} B-5 스킵: 다른 PENDING job 존재로 null 단언 생략`)
    }

    console.log(`${TAG} ✅ 케이스 A/B 전 단계 통과`)
  } finally {
    step('정리 (생성 데이터 삭제)')
    // cascade: product 삭제 → material → post → variant/deployment 연쇄 삭제
    if (created.channelIdA)
      await prisma.boChannel.delete({ where: { id: created.channelIdA } }).catch(() => {})
    if (created.channelIdB)
      await prisma.boChannel.delete({ where: { id: created.channelIdB } }).catch(() => {})
    if (created.productIdA)
      await prisma.boProduct.delete({ where: { id: created.productIdA } }).catch(() => {})
    if (created.productIdB)
      await prisma.boProduct.delete({ where: { id: created.productIdB } }).catch(() => {})
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * blog-ops DELETE_POST 워커 왕복 스모크 테스트
 *
 * smoke-worker-loop.ts 패턴 준용.
 * NAVER_BLOG 채널(BROWSER) + 더미 자격증명(storageState 없음) + DELETING 배포
 * + DELETE_POST job 시드 → 워커가 claim → AUTH_FAILED 반환(non-retryable)
 * → complete API → job FAILED, deployment DELETING → PUBLISHED 복귀 확인.
 *
 * 핵심 assert:
 *   AUTH_FAILED 는 non-retryable → job FAILED
 *   complete route 가 DELETE_POST 최종 실패 시 deployment DELETING → PUBLISHED 복귀
 *
 * 실행 모드:
 *   npx tsx scripts/bo/smoke-worker-delete.ts          # 시드 생성 + 워커 대기 + 검증 + 정리
 *   npx tsx scripts/bo/smoke-worker-delete.ts --seed-only   # 시드만 생성 (워커 별도 기동용)
 *   npx tsx scripts/bo/smoke-worker-delete.ts --verify      # 결과 확인 (워커 처리 후 실행)
 *   npx tsx scripts/bo/smoke-worker-delete.ts --cleanup     # 시드 데이터 삭제
 *
 * 사전 조건(--full 또는 --verify 모드):
 *   웹앱 기동 (WEB_APP_URL, 기본 http://127.0.0.1:3457) + 별도로 워커 폴러 실행 중.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })

const TAG = '[bo-worker-delete-smoke]'
const MARK = '[삭제워커스모크]'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`${TAG} 실패: ${msg}`)
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const { saveBoCredential } = await import('@/lib/bo/credentials')
  const { enqueueBoJob } = await import('@/lib/bo/jobs')

  const mode = process.argv[2] ?? '--full'

  const space = await prisma.space.findFirst({ select: { id: true, name: true } })
  if (!space) throw new Error('스페이스 없음')
  console.log(`${TAG} space: ${space.name} (${space.id}), mode: ${mode}`)

  // ──────────────────────────────────────────────────────────────
  // --cleanup: 시드 데이터 삭제
  // ──────────────────────────────────────────────────────────────
  if (mode === '--cleanup') {
    console.log(`${TAG} 정리 모드: 시드 데이터 삭제`)
    await prisma.boChannel
      .deleteMany({ where: { spaceId: space.id, name: `${MARK} 네이버` } })
      .catch(() => {})
    await prisma.boProduct
      .deleteMany({ where: { spaceId: space.id, name: `${MARK} 상품` } })
      .catch(() => {})
    // 고아 job 정리 (채널/제품 cascade 후 남을 수 있음)
    await prisma.boJob
      .deleteMany({
        where: {
          spaceId: space.id,
          kind: 'DELETE_POST',
          status: { in: ['PENDING', 'CLAIMED', 'FAILED', 'COMPLETED'] },
        },
      })
      .catch(() => {})
    console.log(`${TAG} 정리 완료`)
    await prisma.$disconnect()
    return
  }

  // ──────────────────────────────────────────────────────────────
  // --verify: 워커 처리 결과 확인 (워커가 이미 실행됐거나 실행 대기 중)
  // ──────────────────────────────────────────────────────────────
  if (mode === '--verify') {
    console.log(`${TAG} 검증 모드: deployment + job 상태 확인`)
    const dep = await prisma.boDeployment.findFirst({
      where: { spaceId: space.id, channel: { name: `${MARK} 네이버` } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, errorCode: true, errorMessage: true },
    })
    const job = await prisma.boJob.findFirst({
      where: { spaceId: space.id, kind: 'DELETE_POST' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, errorMessage: true, attempts: true },
    })

    console.log(`${TAG} deployment: ${JSON.stringify(dep)}`)
    console.log(`${TAG} job:        ${JSON.stringify(job)}`)

    // 워커 미처리 시 DELETING + PENDING/CLAIMED 는 아직 대기 중
    if (dep?.status === 'DELETING' && (job?.status === 'PENDING' || job?.status === 'CLAIMED')) {
      console.log(`${TAG} ⏳ 아직 워커 처리 중 — --verify 를 나중에 다시 실행하세요`)
      await prisma.$disconnect()
      return
    }

    // AUTH_FAILED 는 non-retryable → job FAILED
    assert(job?.status === 'FAILED', `job 상태가 FAILED 아님: ${job?.status}`)
    // DELETE_POST 최종 실패 → deployment DELETING → PUBLISHED 복귀 (complete route 로직)
    assert(
      dep?.status === 'PUBLISHED' || dep?.status === 'DELETING',
      `deployment 상태가 예상 범위 밖: ${dep?.status} (PUBLISHED 복귀 또는 아직 DELETING)`
    )
    if (dep?.status === 'PUBLISHED') {
      console.log(
        `${TAG} ✅ 검증 통과: AUTH_FAILED → job FAILED, deployment DELETING → PUBLISHED 복귀`
      )
    } else {
      console.log(`${TAG} ⚠️ deployment 아직 DELETING — complete route 미실행 또는 워커 미완료`)
    }

    await prisma.$disconnect()
    return
  }

  // ──────────────────────────────────────────────────────────────
  // --seed-only 또는 --full: 시드 생성
  // ──────────────────────────────────────────────────────────────
  if (mode === '--seed-only' || mode === '--full') {
    console.log(`${TAG} 시드 생성 (space: ${space.name})`)

    const product = await prisma.boProduct.create({
      data: { spaceId: space.id, name: `${MARK} 상품`, ctaUrl: 'https://example.com' },
    })
    const material = await prisma.boMaterial.create({
      data: {
        spaceId: space.id,
        productId: product.id,
        title: `${MARK} 소재`,
        appealPoint: 't',
        angle: 't',
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    })
    const post = await prisma.boPost.create({
      data: {
        spaceId: space.id,
        materialId: material.id,
        title: `${MARK} 포스트`,
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '삭제 워커 스모크 본문' }] },
          ],
        },
        status: 'PUBLISHED',
        publishApprovedAt: new Date(),
      },
    })
    const channel = await prisma.boChannel.create({
      data: {
        spaceId: space.id,
        platform: 'NAVER_BLOG',
        name: `${MARK} 네이버`,
        publisherMode: 'BROWSER',
        formatProfile: {},
      },
    })
    // 더미 자격증명 — storageState 없음 → 워커가 AUTH_FAILED 로 거절해야 함
    await saveBoCredential({
      spaceId: space.id,
      channelId: channel.id,
      kind: 'COOKIE',
      payload: { note: 'smoke dummy — storageState 없음' },
    })
    const variant = await prisma.boPostVariant.create({
      data: {
        spaceId: space.id,
        postId: post.id,
        channelId: channel.id,
        title: post.title,
        doc: post.doc as object,
        status: 'READY',
      },
    })
    // deployment 는 이미 발행 완료 상태 + 삭제 트리거 시뮬레이션
    // delete route 와 동일하게: PUBLISHED → DELETING 전환 후 DELETE_POST job 큐 등록
    const deployment = await prisma.boDeployment.create({
      data: {
        spaceId: space.id,
        postId: post.id,
        variantId: variant.id,
        channelId: channel.id,
        status: 'DELETING', // delete route 가 PUBLISHED → DELETING 으로 전환한 직후 상태
        platformUrl: 'https://blog.naver.com/smoke-test/999999999',
        publishedAt: new Date(Date.now() - 60_000),
      },
    })
    await enqueueBoJob({
      spaceId: space.id,
      kind: 'DELETE_POST',
      targetId: deployment.id,
      payload: { deploymentId: deployment.id },
    })

    console.log(`${TAG} 시드 완료. deploymentId=${deployment.id}`)
  }

  if (mode === '--seed-only') {
    console.log(`${TAG} --seed-only 모드 종료. 워커 폴러 기동 후 --verify 로 결과 확인.`)
    await prisma.$disconnect()
    return
  }

  // ──────────────────────────────────────────────────────────────
  // --full: 워커 처리 대기 (최대 60초 폴링) + 검증 + 정리
  // ──────────────────────────────────────────────────────────────
  console.log(`${TAG} 워커 처리 대기 (최대 60초)...`)
  const { prisma: prismaRef } = await import('@/lib/prisma')
  const deadline = Date.now() + 60_000
  let finalDep: {
    id: string
    status: string
    errorCode: string | null
    errorMessage: string | null
  } | null = null
  let finalJob: {
    id: string
    status: string
    errorMessage: string | null
    attempts: number
  } | null = null

  while (Date.now() < deadline) {
    const dep = await prismaRef.boDeployment.findFirst({
      where: { spaceId: space.id, channel: { name: `${MARK} 네이버` } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, errorCode: true, errorMessage: true },
    })
    const job = await prismaRef.boJob.findFirst({
      where: { spaceId: space.id, kind: 'DELETE_POST' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, errorMessage: true, attempts: true },
    })

    const depDone = dep && dep.status !== 'DELETING'
    const jobDone = job && job.status !== 'PENDING' && job.status !== 'CLAIMED'
    if (depDone || jobDone) {
      finalDep = dep ?? null
      finalJob = job ?? null
      break
    }
    await new Promise((r) => setTimeout(r, 3000))
  }

  // 정리
  const cleanup = async () => {
    await prismaRef.boChannel
      .deleteMany({ where: { spaceId: space.id, name: `${MARK} 네이버` } })
      .catch(() => {})
    await prismaRef.boProduct
      .deleteMany({ where: { spaceId: space.id, name: `${MARK} 상품` } })
      .catch(() => {})
  }

  if (!finalDep && !finalJob) {
    await cleanup()
    await prismaRef.$disconnect()
    throw new Error(`${TAG} 60초 내 워커 처리 없음 — 워커 폴러가 실행 중인지 확인`)
  }

  console.log(`${TAG} 최종 deployment: ${JSON.stringify(finalDep)}`)
  console.log(`${TAG} 최종 job:        ${JSON.stringify(finalJob)}`)

  // AUTH_FAILED(non-retryable) → job FAILED
  assert(finalJob?.status === 'FAILED', `job 상태가 FAILED 아님: ${finalJob?.status}`)
  // DELETE_POST 최종 실패 → complete route 가 deployment DELETING → PUBLISHED 로 복귀
  assert(
    finalDep?.status === 'PUBLISHED',
    `deployment 가 PUBLISHED 로 복귀 안 됨: ${finalDep?.status} (complete route DELETE_POST 실패 복귀 로직 미동작)`
  )

  console.log(
    `${TAG} ✅ 워커 왕복 검증 통과 (claim→AUTH_FAILED→FAILED, deployment DELETING→PUBLISHED 복귀)`
  )

  await cleanup()
  await prismaRef.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

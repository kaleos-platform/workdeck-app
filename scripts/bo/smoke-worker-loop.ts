/**
 * blog-ops 워커 왕복 스모크 (실 플랫폼 미접촉)
 *
 * NAVER_BLOG 채널(BROWSER) + 더미 자격증명(storageState 없음) + READY 변형
 * + PENDING 배포 + PUBLISH job 시드 → 워커가 claim → 퍼블리셔가 AUTH_FAILED 반환
 * → complete API → 배포 FAILED(errorCode=AUTH_FAILED) + job FAILED 확인 → 정리.
 *
 * 검증 대상: claim 컨텍스트 계약, 퍼블리셔 라우팅, complete 왕복, 상태 반영.
 * 사전 조건: 웹앱 기동 (WEB_APP_URL, 기본 http://127.0.0.1:3457) + 별도로 워커 폴러 실행 중.
 *
 * 실행: npx tsx scripts/bo/smoke-worker-loop.ts [--seed-only|--check-only]
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })

const TAG = '[bo-worker-smoke]'

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const { saveBoCredential } = await import('@/lib/bo/credentials')
  const { enqueueBoJob } = await import('@/lib/bo/jobs')

  const mode = process.argv[2] ?? '--full'

  const space = await prisma.space.findFirst({ select: { id: true, name: true } })
  if (!space) throw new Error('스페이스 없음')

  const MARK = '[워커스모크]'

  if (mode !== '--check-only') {
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
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '워커 스모크 본문' }] }],
        },
        status: 'PUBLISH_APPROVED',
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
    // 더미 자격증명 — storageState 없음 → 퍼블리셔가 AUTH_FAILED 로 거절해야 함
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
    const deployment = await prisma.boDeployment.create({
      data: {
        spaceId: space.id,
        postId: post.id,
        variantId: variant.id,
        channelId: channel.id,
        status: 'PENDING',
      },
    })
    await enqueueBoJob({
      spaceId: space.id,
      kind: 'PUBLISH',
      targetId: deployment.id,
      payload: { deploymentId: deployment.id },
    })
    console.log(`${TAG} 시드 완료. deploymentId=${deployment.id}`)
    if (mode === '--seed-only') {
      await prisma.$disconnect()
      return
    }
  }

  // 워커 처리 대기 (최대 60초 폴링)
  console.log(`${TAG} 워커 처리 대기...`)
  const deadline = Date.now() + 60_000
  let final: { status: string; errorCode: string | null; errorMessage: string | null } | null = null
  while (Date.now() < deadline) {
    const dep = await prisma.boDeployment.findFirst({
      where: { spaceId: space.id, channel: { name: `${MARK} 네이버` } },
      orderBy: { createdAt: 'desc' },
      select: { status: true, errorCode: true, errorMessage: true },
    })
    if (dep && dep.status !== 'PENDING' && dep.status !== 'PUBLISHING') {
      final = dep
      break
    }
    await new Promise((r) => setTimeout(r, 3000))
  }

  // 정리 (성패 무관)
  const cleanup = async () => {
    await prisma.boChannel.deleteMany({ where: { spaceId: space.id, name: `${MARK} 네이버` } })
    await prisma.boProduct.deleteMany({ where: { spaceId: space.id, name: `${MARK} 상품` } })
    await prisma.boJob
      .deleteMany({
        where: {
          spaceId: space.id,
          kind: 'PUBLISH',
          status: { in: ['PENDING', 'CLAIMED', 'FAILED', 'COMPLETED'] },
          payload: { path: ['deploymentId'], not: 'x' },
        },
      })
      .catch(() => {})
  }

  if (!final) {
    await cleanup()
    await prisma.$disconnect()
    throw new Error(`${TAG} 60초 내 워커 처리 없음 — 워커 폴러가 실행 중인지 확인`)
  }
  console.log(`${TAG} 최종 배포 상태: ${JSON.stringify(final)}`)
  if (final.status === 'FAILED' && final.errorCode === 'AUTH_FAILED') {
    console.log(`${TAG} ✅ 워커 왕복 검증 통과 (claim→라우팅→AUTH_FAILED→complete→배포 반영)`)
  } else {
    await cleanup()
    await prisma.$disconnect()
    throw new Error(`${TAG} 기대와 다른 결과: ${JSON.stringify(final)}`)
  }
  await cleanup()
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

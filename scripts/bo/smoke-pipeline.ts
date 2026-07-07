/**
 * blog-ops 파이프라인 스모크 테스트 (LLM 미사용 경로)
 *
 * 제품 생성 → 소재 수동 등록 → 승인(게이트#1) → 포스트 생성(샘플 doc)
 * → 검토 → 발행 승인(게이트#2) → OWN_HOMEPAGE 채널 → passthrough 변형
 * → MD/HTML export → EXPORTED 배포 기록 → 정리(삭제)
 *
 * 실행: npx tsx scripts/bo/smoke-pipeline.ts
 * 종료 코드 0 = 전 단계 통과. 생성 데이터는 끝에서 전부 삭제.
 */
// 정적 import 는 hoisting 되므로 prisma 등은 dynamic import 로 dotenv 이후에 로드한다. (scripts/sc/ops 패턴)
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: true })

const TAG = '[bo-smoke]'

function step(name: string) {
  console.log(`${TAG} ▶ ${name}`)
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`${TAG} 실패: ${msg}`)
}

const SAMPLE_DOC = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '스모크 테스트 소제목' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '이 문단은 스모크 테스트용입니다. ' },
        { type: 'text', marks: [{ type: 'bold' }], text: '굵은 텍스트' },
        { type: 'text', text: '와 ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/cta' } }],
          text: 'CTA 링크',
        },
        { type: 'text', text: '를 포함합니다.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '항목 하나' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '항목 둘' }] }],
        },
      ],
    },
  ],
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const { assertBoMaterialTransition } = await import('@/lib/bo/material-state')
  const { assertBoPostTransition } = await import('@/lib/bo/post-state')
  const { generateBoVariant } = await import('@/lib/bo/variant-generator')
  const { docToMarkdown } = await import('@/lib/bo/exporters/markdown')
  const { docToHtml } = await import('@/lib/bo/exporters/html')
  const { DEFAULT_PROFILES } = await import('@/lib/bo/channel-profiles')

  const created = {
    productId: '',
    materialId: '',
    postId: '',
    channelId: '',
    variantId: '',
    deploymentIds: [] as string[],
  }

  const space = await prisma.space.findFirst({ select: { id: true, name: true } })
  assert(space, '스페이스가 없음 — seed 필요')
  console.log(`${TAG} space: ${space.name} (${space.id})`)

  try {
    step('1. 제품 생성')
    const product = await prisma.boProduct.create({
      data: {
        spaceId: space.id,
        name: '[스모크] 테스트 상품',
        category: 'B2B',
        oneLinerPitch: '스모크 테스트용 상품',
        ctaUrl: 'https://example.com/cta',
      },
    })
    created.productId = product.id

    step('2. 소재 수동 등록 (PROPOSED)')
    const material = await prisma.boMaterial.create({
      data: {
        spaceId: space.id,
        productId: product.id,
        title: '[스모크] 테스트 소재',
        appealPoint: '테스트 소구점',
        angle: '테스트 앵글',
        outline: [{ section: '서론', description: '테스트' }],
        status: 'PROPOSED',
      },
    })
    created.materialId = material.id

    step('3. 소재 승인 게이트 #1 (PROPOSED→APPROVED)')
    assertBoMaterialTransition('PROPOSED', 'APPROVED')
    let threw = false
    try {
      assertBoMaterialTransition('PROPOSED', 'ARCHIVED')
    } catch {
      threw = true
    }
    assert(threw, '잘못된 전이(PROPOSED→ARCHIVED)가 차단되지 않음')
    await prisma.boMaterial.update({
      where: { id: material.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    })

    step('4. 포스트 생성 (DRAFT, 샘플 doc)')
    const post = await prisma.boPost.create({
      data: {
        spaceId: space.id,
        materialId: material.id,
        title: '[스모크] 테스트 포스트',
        doc: SAMPLE_DOC,
        status: 'DRAFT',
        ctaUrl: product.ctaUrl,
      },
    })
    created.postId = post.id

    step('5. 발행 승인 게이트 #2 (DRAFT→IN_REVIEW→PUBLISH_APPROVED)')
    assertBoPostTransition('DRAFT', 'IN_REVIEW')
    assertBoPostTransition('IN_REVIEW', 'PUBLISH_APPROVED')
    threw = false
    try {
      assertBoPostTransition('DRAFT', 'PUBLISH_APPROVED')
    } catch {
      threw = true
    }
    assert(threw, '게이트 우회 전이(DRAFT→PUBLISH_APPROVED)가 차단되지 않음')
    await prisma.boPost.update({
      where: { id: post.id },
      data: { status: 'PUBLISH_APPROVED', publishApprovedAt: new Date() },
    })

    step('6. OWN_HOMEPAGE 채널 생성 (passthrough)')
    const channel = await prisma.boChannel.create({
      data: {
        spaceId: space.id,
        platform: 'OWN_HOMEPAGE',
        name: '[스모크] 자체 홈페이지',
        formatProfile: DEFAULT_PROFILES.OWN_HOMEPAGE as object,
      },
    })
    created.channelId = channel.id

    step('7. passthrough 변형 생성 (LLM 미사용)')
    const result = await generateBoVariant({
      postId: post.id,
      channelId: channel.id,
      spaceId: space.id,
    })
    assert(
      result.ok && result.variantId,
      `변형 생성 실패: ${'code' in result ? result.code : ''} ${'message' in result ? result.message : ''}`
    )
    created.variantId = result.variantId
    const variant = await prisma.boPostVariant.findUniqueOrThrow({
      where: { id: result.variantId },
    })
    assert(variant.status === 'READY', `변형 상태 READY 아님: ${variant.status}`)

    step('8. MD/HTML export')
    const md = docToMarkdown(variant.doc as never)
    const html = docToHtml(variant.doc as never)
    assert(
      md.includes('스모크 테스트 소제목') && md.includes('**굵은 텍스트**'),
      'Markdown export 내용 불일치'
    )
    assert(
      html.includes('<h2') && html.includes('https://example.com/cta'),
      'HTML export 내용 불일치'
    )

    step('9. EXPORTED 배포 기록')
    const deployment = await prisma.boDeployment.create({
      data: {
        spaceId: space.id,
        postId: post.id,
        variantId: variant.id,
        channelId: channel.id,
        status: 'EXPORTED',
      },
    })
    created.deploymentIds.push(deployment.id)

    console.log(`${TAG} ✅ 전 단계 통과`)
  } finally {
    step('정리 (생성 데이터 삭제)')
    // FK cascade: product 삭제 → ideation/material → post → variant/deployment 연쇄 삭제
    if (created.channelId)
      await prisma.boChannel.delete({ where: { id: created.channelId } }).catch(() => {})
    if (created.productId)
      await prisma.boProduct.delete({ where: { id: created.productId } }).catch(() => {})
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

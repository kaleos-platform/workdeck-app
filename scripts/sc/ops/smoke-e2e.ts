// Sales Content — End-to-End Smoke Test (ops 도구).
//
// Phase 3 First Smoke 의 핵심 흐름을 자동 실행한다. Worker API ↔ Runner contract 변경
// 이후 회귀 검증, 또는 신규 환경(스테이징 등) bring-up 시 즉시 사용 가능.
//
// 흐름:
//   1) Space 결정 (--spaceId arg 또는 첫 번째 활성 sales-content DeckInstance)
//   2) BLOG_NAVER 채널 upsert (publisherMode=BROWSER, collectorMode=BROWSER)
//   3) ChannelCredential upsert (/tmp/naver-session.json + blogId 인자)
//   4) Content 생성 (status=APPROVED) + 단순 TipTap doc
//   5) ContentDeployment 생성 (status=SCHEDULED, shortSlug 자동 생성)
//   6) PUBLISH job enqueue + deployment.status=PUBLISHING
//   7) 워커가 처리할 때까지 deployment.status polling (timeout 3분)
//   8) 결과 출력 (platformUrl, status, errorMessage)
//
// 전제: 별도 터미널에서 `npm run dev` + `cd worker && WORKER_API_KEY=... npm run sc` 실행.
// 인증 단순화를 위해 enqueueJob 은 prisma 직접 호출 (execute API 의 session 인증 우회).
// status=FAILED + errorMessage="네이버 세션이 만료됐습니다" 가 나오면 storageState 갱신 필요:
//   npx tsx scripts/sc/acquire-naver-session.ts --manual
// 한 뒤 재실행.
//
// 사용:
//   npx tsx scripts/sc/ops/smoke-e2e.ts --blogId meaning-lab [--spaceId <id>] [--sessionFile /tmp/naver-session.json]

// .env.local 명시 로드 — tsx 단독 실행 시 Next.js 가 읽지 않으므로 직접 주입.
// 정적 import 는 hoisting 되므로 prisma 등은 dynamic import 로 dotenv 이후에 로드한다.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { readFileSync } from 'node:fs'

type Args = {
  blogId: string
  spaceId?: string
  sessionFile: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const blogId = get('--blogId')
  if (!blogId) {
    console.error('Usage: --blogId <id> [--spaceId <id>] [--sessionFile <path>]')
    process.exit(1)
  }
  return {
    blogId,
    spaceId: get('--spaceId'),
    sessionFile: get('--sessionFile') ?? '/tmp/naver-session.json',
  }
}

async function findSpace(spaceIdArg?: string): Promise<{ id: string; name: string }> {
  const { prisma } = mods()
  if (spaceIdArg) {
    const s = await prisma.space.findUnique({ where: { id: spaceIdArg } })
    if (!s) throw new Error(`Space ${spaceIdArg} 없음`)
    return s
  }
  // sales-content Deck 이 활성된 첫 Space 선택
  const di = await prisma.deckInstance.findFirst({
    where: { deckAppId: 'sales-content', isActive: true },
    include: { space: true },
  })
  if (!di) throw new Error('sales-content 가 활성된 Space 없음 — --spaceId 직접 지정')
  return di.space
}

async function upsertChannel(spaceId: string) {
  const { prisma } = mods()
  const platformSlug = 'naver-blog-smoke'
  return prisma.salesContentChannel.upsert({
    where: { spaceId_platformSlug: { spaceId, platformSlug } },
    create: {
      spaceId,
      platform: 'BLOG_NAVER',
      kind: 'BLOG',
      name: '네이버 블로그 (smoke)',
      platformSlug,
      publisherMode: 'BROWSER',
      collectorMode: 'BROWSER',
      isActive: true,
      config: {},
    },
    update: {
      publisherMode: 'BROWSER',
      collectorMode: 'BROWSER',
      isActive: true,
    },
  })
}

async function upsertCredential(
  spaceId: string,
  channelId: string,
  blogId: string,
  sessionFile: string
) {
  const storageState = JSON.parse(readFileSync(sessionFile, 'utf-8'))
  await mods().upsertChannelCredential({
    spaceId,
    channelId,
    kind: 'COOKIE',
    payload: { storageState, blogId },
  })
}

async function createContent(spaceId: string) {
  const { prisma } = mods()
  const title = `[SMOKE-E2E] ${new Date().toISOString().slice(0, 19)}`
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Workdeck sales-content Phase 3 첫 end-to-end 스모크 테스트 본문입니다.',
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '워커 → Publisher → Collector 의 전 구간을 검증합니다.',
          },
        ],
      },
    ],
  }
  return prisma.content.create({
    data: { spaceId, title, status: 'APPROVED', doc },
  })
}

async function createDeployment(spaceId: string, contentId: string, channelId: string) {
  const { prisma, generateShortSlug } = mods()
  return prisma.contentDeployment.create({
    data: {
      spaceId,
      contentId,
      channelId,
      shortSlug: generateShortSlug(),
      targetUrl: 'https://workdeck.work',
      status: 'SCHEDULED',
      utmSource: 'naver-blog-smoke',
      utmMedium: 'BLOG',
      utmCampaign: 'phase3-smoke',
      scheduledAt: new Date(),
    },
  })
}

async function enqueuePublish(spaceId: string, deploymentId: string) {
  const { prisma } = mods()
  await prisma.contentDeployment.update({
    where: { id: deploymentId },
    data: { status: 'PUBLISHING', errorMessage: null },
  })
  return prisma.salesContentJob.create({
    data: {
      spaceId,
      kind: 'PUBLISH',
      targetId: deploymentId,
      payload: { deploymentId },
      status: 'PENDING',
      scheduledAt: new Date(),
    },
  })
}

async function pollDeployment(
  deploymentId: string,
  timeoutMs = 180_000
): Promise<{ status: string; platformUrl: string | null; errorMessage: string | null }> {
  const { prisma } = mods()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const d = await prisma.contentDeployment.findUnique({
      where: { id: deploymentId },
      select: { status: true, platformUrl: true, errorMessage: true },
    })
    if (!d) throw new Error('deployment 사라짐')
    if (d.status === 'PUBLISHED' || d.status === 'FAILED') {
      return d
    }
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('polling 타임아웃 (3분)')
}

// 모듈 평가 시점에 prisma 가 DATABASE_URL 을 읽으므로,
// dotenv 가 먼저 실행되도록 dynamic import 로 전환한다.
let _modules: {
  prisma: typeof import('../../../src/lib/prisma').prisma
  upsertChannelCredential: typeof import('../../../src/lib/sc/credentials').upsertChannelCredential
  generateShortSlug: typeof import('../../../src/lib/sc/utm').generateShortSlug
} | null = null

function mods() {
  if (!_modules) throw new Error('modules 가 아직 로드되지 않았습니다')
  return _modules
}

async function main() {
  _modules = {
    prisma: (await import('../../../src/lib/prisma')).prisma,
    upsertChannelCredential: (await import('../../../src/lib/sc/credentials'))
      .upsertChannelCredential,
    generateShortSlug: (await import('../../../src/lib/sc/utm')).generateShortSlug,
  }

  const args = parseArgs()
  console.log(`[smoke-e2e] blogId=${args.blogId} sessionFile=${args.sessionFile}`)

  const space = await findSpace(args.spaceId)
  console.log(`[smoke-e2e] space=${space.id} (${space.name})`)

  const channel = await upsertChannel(space.id)
  console.log(`[smoke-e2e] channel=${channel.id} (${channel.name})`)

  await upsertCredential(space.id, channel.id, args.blogId, args.sessionFile)
  console.log('[smoke-e2e] credential upserted')

  const content = await createContent(space.id)
  console.log(`[smoke-e2e] content=${content.id} title=${content.title}`)

  const deployment = await createDeployment(space.id, content.id, channel.id)
  console.log(
    `[smoke-e2e] deployment=${deployment.id} shortSlug=${deployment.shortSlug} targetUrl=${deployment.targetUrl}`
  )

  const job = await enqueuePublish(space.id, deployment.id)
  console.log(`[smoke-e2e] PUBLISH job enqueued: ${job.id}`)
  console.log('[smoke-e2e] 워커 처리 대기 중 (3분 timeout)...')

  const result = await pollDeployment(deployment.id)
  console.log()
  console.log('[smoke-e2e] 결과:', JSON.stringify(result, null, 2))

  process.exit(result.status === 'PUBLISHED' ? 0 : 1)
}

main().catch((e) => {
  console.error('[smoke-e2e] 예외:', e)
  process.exit(1)
})

/**
 * 자동 이전 plan 처리기의 순수 조립부. prepare·import·DB 접근은 주입받아 단위 테스트로 고정한다.
 * 실제 의존성은 scripts/opening-auto-migrate.ts 가 넘긴다.
 */
import {
  buildAutoReview,
  buildSnapshot,
  classifyPlan,
  extractContactFragments,
  type Candidates,
  type PlanInput,
  type PacketSnapshot,
} from './auto-job'

// 연락처 항목 자동 review 를 prepare 결과로 갱신해 다시 prepare 하는 최대 횟수.
export const MAX_REVIEW_PASSES = 3
export const MAX_ATTEMPTS = 3

export type ReviewItemLike = Candidates['items'][number] & {
  texts: { path: string; text: string; flagged: boolean }[]
}
export type PreparedLike = {
  summary: PlanInput['summary'] & { review: { pendingItems: number } }
  review: {
    sourceSpaceId: string
    items: ReviewItemLike[]
    images: { sha256: string; owners: string[] }[]
  }
  postings: { sourcePostingId: string; posting: { title: string } }[]
  templates: { sourceTemplateId: string; name: string }[]
}

export type PlanDeps<P extends PreparedLike> = {
  prepare: (review?: unknown) => Promise<P>
  // 최종 prepare 결과를 packet 폴더에 쓴다(buildSnapshot 이 이 폴더를 읽는다).
  writePackets: (prepared: P) => void
  dryRun: (review: unknown) => Promise<{ conflicts: number; refused: number; summary: object }>
  targetHasData: (spaceId: string) => Promise<boolean>
}

export async function computePlan<P extends PreparedLike>(
  deps: PlanDeps<P>,
  input: {
    jobId: string
    userId: string
    targetSpaceId: string | null
    brandCount: number
    packetsDir: string
    today: string
  }
) {
  // ① review 없이 prepare → 연락처 항목·이미지 후보
  const first = await deps.prepare()
  const items = new Map<string, ReviewItemLike>()
  const images = new Map<string, { sha256: string; owners: string[] }>()
  const merge = (review: PreparedLike['review']) => {
    for (const item of review.items) items.set(`${item.kind}:${item.id}`, item)
    for (const image of review.images) images.set(image.sha256, image)
  }
  const buildReview = () =>
    buildAutoReview(
      {
        sourceSpaceId: first.review.sourceSpaceId,
        items: [...items.values()],
        images: [...images.values()],
      },
      input.jobId,
      input.today
    )
  merge(first.review)

  // ② 자동 review 로 prepare. 내장 이미지+연락처 항목처럼 1단계에 안 잡힌 항목이 남으면 갱신해 반복한다.
  let review = buildReview()
  let prepared = await deps.prepare(review)
  for (let pass = 1; prepared.summary.review.pendingItems > 0 && pass < MAX_REVIEW_PASSES; pass++) {
    merge(prepared.review)
    review = buildReview()
    prepared = await deps.prepare(review)
  }
  const reviewIncomplete = prepared.summary.review.pendingItems > 0
  if (reviewIncomplete) merge(prepared.review)

  deps.writePackets(prepared)
  const dry = input.targetSpaceId
    ? await deps.dryRun(review)
    : { conflicts: 0, refused: 0, summary: {} }
  const targetHasData = input.targetSpaceId ? await deps.targetHasData(input.targetSpaceId) : false
  const { blockReasons, warnings } = classifyPlan({
    targetSpaceId: input.targetSpaceId,
    brandCount: input.brandCount,
    summary: prepared.summary,
    conflicts: dry.conflicts,
    refused: dry.refused,
    reviewIncomplete,
    targetHasData,
  })
  const snapshot: PacketSnapshot = buildSnapshot(input.packetsDir, {
    userId: input.userId,
    targetSpaceId: input.targetSpaceId,
    adminMatched: true,
  })

  // 연락처 조각은 최종 패스까지 누적된 전체 연락처 항목 기준이다.
  const titles = new Map<string, string>([
    ...prepared.postings.map((p) => [`posting:${p.sourcePostingId}`, p.posting.title] as const),
    ...prepared.templates.map((t) => [`template:${t.sourceTemplateId}`, t.name] as const),
  ])
  const fragments = extractContactFragments(
    [...items.values()].map((item) => ({ ...item, title: titles.get(`${item.kind}:${item.id}`) }))
  ).filter((item) => item.fragments.length)

  return {
    first,
    prepared,
    review,
    blockReasons,
    warnings,
    snapshot,
    fragments,
    dryRunSummary: dry.summary,
  }
}

export const fixedCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z_]{2,80}$/.test(message) ? message : 'OPENING_AUTO_MIGRATE_FAILED'
}

export type QueueJob = {
  id: string
  userId: string
  openingBrandId: string
  status: 'MATCHED' | 'BLOCKED'
}
export type QueueDeps = {
  // MATCHED(attempts 미만) 중 가장 오래된 1건
  nextMatched: () => Promise<QueueJob | null>
  // NO_TARGET_SPACE 만으로 막힌 BLOCKED, updatedAt 오래된 순
  blockedRetries: () => Promise<QueueJob[]>
  targetFor: (userId: string) => Promise<string | null>
  // 건너뛴 행의 updatedAt 을 갱신해 다음 주기에 뒤로 보낸다(순환).
  touch: (id: string) => Promise<void>
  plan: (job: QueueJob, targetSpaceId: string | null) => Promise<void>
  fail: (job: QueueJob, code: string) => Promise<void>
}

// 한 주기에 1건. 새 MATCHED 를 먼저 처리하고, 그다음에야 NO_TARGET_SPACE 재시도를 본다.
export async function planNext(deps: QueueDeps) {
  const run = async (job: QueueJob, target: string | null) => {
    try {
      await deps.plan(job, target)
      return { status: 'PLANNED' as const, jobId: job.id }
    } catch (error) {
      await deps.fail(job, fixedCode(error))
      return { status: 'PLAN_FAILED' as const, jobId: job.id }
    }
  }
  const matched = await deps.nextMatched()
  if (matched) return run(matched, await deps.targetFor(matched.userId))
  for (const job of await deps.blockedRetries()) {
    const target = await deps.targetFor(job.userId)
    // 대상 Space 가 아직 없으면 원본을 다시 읽지 않고 순환만 시킨다.
    if (!target) {
      await deps.touch(job.id)
      continue
    }
    return run(job, target)
  }
  return { status: 'PLAN_NONE' as const }
}

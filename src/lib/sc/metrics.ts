import { prisma } from '@/lib/prisma'
import type { MetricSource } from '@/generated/prisma/client'
// 타입 계약은 metrics-types.ts 에서 관리 (Bernstein 의 구현과 병렬 작업).
export type {
  SpaceContentAnalyticsRow,
  ContentMetricsTotal,
  ContentCompareRow,
} from './metrics-types'
import type {
  SpaceContentAnalyticsRow,
  ContentMetricsTotal,
  ContentCompareRow,
} from './metrics-types'
// source 우선순위 dedup — 순수 함수 (Prisma 비의존, 유닛 테스트 가능)
export { pickDailyMetrics } from './metrics-dedup'
import { pickDailyMetrics } from './metrics-dedup'

// ─── 구현 ─────────────────────────────────────────────────────────────────────

/** ISO 날짜 문자열 (YYYY-MM-DD) 생성 헬퍼 */
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * 14일 날짜 스파인 생성 (오늘 포함 14일, 과거 → 현재 순).
 * 반환값은 YYYY-MM-DD 문자열 배열.
 */
function buildDateSpine14(): string[] {
  const spine: string[] = []
  const today = startOfDayUTC(new Date())
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    spine.push(toISODate(d))
  }
  return spine
}

/**
 * 스페이스의 콘텐츠 단위 성과 데이터를 반환한다.
 * - 배포가 1개 이상 있는 콘텐츠만 포함 (최대 200건, 최신순)
 * - N+1 방지: DeploymentMetric 은 groupBy 로 한 번에 조회
 * - 각 행에 sparkline (최근 14일 일별 조회, 14개 고정 spine 포함)
 * - 200건 초과 시 hasMore=true, totalCount 메타 반환
 */
export async function getSpaceContentAnalytics(
  spaceId: string
): Promise<{ rows: SpaceContentAnalyticsRow[]; totalCount: number; hasMore: boolean }> {
  const where = { spaceId, deployments: { some: {} } } as const

  // 1. 배포가 있는 콘텐츠 fetch (channel 정보 + clickEvents 건수 포함) + 전체 건수 병행
  const [contents, totalCount] = await Promise.all([
    prisma.content.findMany({
      where,
      include: {
        deployments: {
          include: {
            channel: { select: { id: true, name: true, kind: true, platform: true } },
            _count: { select: { clickEvents: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    prisma.content.count({ where }),
  ])

  if (contents.length === 0) return { rows: [], totalCount: 0, hasMore: false }

  // 2. 모든 deployment ID 를 모아 metrics groupBy 한 번에 조회
  const deploymentIds = contents.flatMap((c) => c.deployments.map((d) => d.id))
  const metricSums = await prisma.deploymentMetric.groupBy({
    by: ['deploymentId'],
    where: { deploymentId: { in: deploymentIds } },
    _sum: {
      impressions: true,
      views: true,
      likes: true,
      externalClicks: true,
    },
  })
  const sumByDeployment = new Map(metricSums.map((r) => [r.deploymentId, r._sum]))

  // 3. sparkline 용: 최근 14일 (deploymentId + date) 그룹핑
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 13)
  const sparklineRows = await prisma.deploymentMetric.groupBy({
    by: ['deploymentId', 'date'],
    where: {
      deploymentId: { in: deploymentIds },
      date: { gte: startOfDayUTC(since) },
    },
    _sum: { views: true },
  })
  // deploymentId → contentId 매핑 (deployments 에서 역추적)
  const deploymentToContent = new Map<string, string>()
  for (const c of contents) {
    for (const d of c.deployments) {
      deploymentToContent.set(d.id, c.id)
    }
  }
  // contentId + date → views 합산 (여러 배포 + 여러 source 합산)
  const contentDateViews = new Map<string, number>()
  for (const row of sparklineRows) {
    const contentId = deploymentToContent.get(row.deploymentId)
    if (!contentId) continue
    const key = `${contentId}__${toISODate(row.date)}`
    contentDateViews.set(key, (contentDateViews.get(key) ?? 0) + (row._sum.views ?? 0))
  }
  const dateSpine = buildDateSpine14()

  // 4. 콘텐츠 단위 집계
  const rows = contents.map((c) => {
    // internalClicks: ContentClickEvent 건수 합산
    const internalClicks = c.deployments.reduce((acc, d) => acc + d._count.clickEvents, 0)

    // metrics: impressions/views/likes/externalClicks 합산
    const metrics = c.deployments.reduce(
      (acc, d) => {
        const m = sumByDeployment.get(d.id)
        return {
          impressions: acc.impressions + (m?.impressions ?? 0),
          views: acc.views + (m?.views ?? 0),
          likes: acc.likes + (m?.likes ?? 0),
          externalClicks: acc.externalClicks + (m?.externalClicks ?? 0),
        }
      },
      { impressions: 0, views: 0, likes: 0, externalClicks: 0 }
    )

    // latestPublishedAt: 배포 publishedAt 중 최신값
    const latestPublishedAt =
      c.deployments
        .filter((d) => d.publishedAt !== null)
        .map((d) => d.publishedAt!)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

    // channels: 고유 채널 목록 (배포 순서 기준 첫 등장 보존)
    const seenChannelIds = new Set<string>()
    const channels = c.deployments
      .filter((d) => !seenChannelIds.has(d.channelId) && (seenChannelIds.add(d.channelId), true))
      .map((d) => ({
        id: d.channel.id,
        name: d.channel.name,
        platform: d.channel.platform,
        kind: d.channel.kind,
      }))

    // sparkline: 14일 spine 기준으로 조회수 채움 (없는 날 = 0)
    const sparkline = dateSpine.map((date) => ({
      date,
      views: contentDateViews.get(`${c.id}__${date}`) ?? 0,
    }))

    return {
      id: c.id,
      title: c.title,
      status: c.status,
      latestPublishedAt,
      channels,
      metrics: { ...metrics, internalClicks },
      sparkline,
    }
  })

  return { rows, totalCount, hasMore: totalCount > 200 }
}

/**
 * 날짜 spine 생성 헬퍼 — startDate 부터 오늘까지 (최대 maxDays 일).
 * 반환값은 YYYY-MM-DD 문자열 배열 (과거 → 현재 순).
 */
function buildDateSpine(startDate: Date, maxDays = 90): string[] {
  const today = startOfDayUTC(new Date())
  const start = startOfDayUTC(startDate)
  const diffMs = today.getTime() - start.getTime()
  const diffDays = Math.min(Math.floor(diffMs / 86_400_000), maxDays - 1)
  const spine: string[] = []
  for (let i = diffDays; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    spine.push(toISODate(d))
  }
  return spine
}

/**
 * 단일 콘텐츠의 합계 지표 + 배포별 분해 + 일별 추이를 반환한다.
 * - N+1 방지: DeploymentMetric 은 groupBy 로 한 번에 조회
 * - 배포가 0개면 빈 데이터 반환
 */
export async function getContentMetricsTotal(contentId: string, spaceId: string): Promise<ContentMetricsTotal> {
  // 1. 콘텐츠의 모든 배포 fetch (channel 정보 + clickEvents 건수 포함)
  const deployments = await prisma.contentDeployment.findMany({
    where: { contentId, spaceId },
    include: {
      channel: { select: { id: true, name: true, platform: true, kind: true } },
      _count: { select: { clickEvents: true } },
    },
  })

  if (deployments.length === 0) {
    return {
      total: {
        impressions: 0,
        views: 0,
        likes: 0,
        comments: 0,
        internalClicks: 0,
        externalClicks: 0,
        channelCount: 0,
      },
      daily: [],
      byDeployment: [],
    }
  }

  // 2. metrics groupBy 한 번에 조회 (전체 합계용)
  const deploymentIds = deployments.map((d) => d.id)
  const metricSums = await prisma.deploymentMetric.groupBy({
    by: ['deploymentId'],
    where: { deploymentId: { in: deploymentIds } },
    _sum: {
      impressions: true,
      views: true,
      likes: true,
      comments: true,
      externalClicks: true,
    },
  })
  const sumByDeployment = new Map(metricSums.map((r) => [r.deploymentId, r._sum]))

  // 3. 일별 추이용 groupBy (date 기준, 모든 배포 합산)
  const dailyGrouped = await prisma.deploymentMetric.groupBy({
    by: ['date'],
    where: { deploymentId: { in: deploymentIds } },
    _sum: {
      impressions: true,
      views: true,
      likes: true,
      comments: true,
      externalClicks: true,
    },
    orderBy: { date: 'asc' },
  })

  // 4. 날짜 spine 구성 (첫 게시일 기준, 최대 90일)
  const earliestPublishedAt = deployments
    .filter((d) => d.publishedAt !== null)
    .map((d) => d.publishedAt!)
    .sort((a, b) => a.getTime() - b.getTime())[0]

  let daily: import('./metrics-types').DailyMetricRow[] = []
  if (dailyGrouped.length > 0 || earliestPublishedAt) {
    // 첫 게시일이 없는 경우 (publishedAt=null 이지만 메트릭이 존재하는 예외 케이스):
    // dailyGrouped 는 orderBy date asc 이므로 첫 행이 가장 과거 날짜.
    const earliestFromMetrics = dailyGrouped[0]?.date
    const spineStart = earliestPublishedAt ?? earliestFromMetrics ?? new Date()
    const spine = buildDateSpine(spineStart)
    // date string → grouped row 매핑
    const groupedByDate = new Map(dailyGrouped.map((r) => [toISODate(r.date), r._sum]))
    daily = spine.map((date) => {
      const s = groupedByDate.get(date)
      return {
        date,
        impressions: s?.impressions ?? 0,
        views: s?.views ?? 0,
        likes: s?.likes ?? 0,
        comments: s?.comments ?? 0,
        externalClicks: s?.externalClicks ?? 0,
      }
    })
  }

  // 5. 배포별 데이터 구성
  const byDeployment = deployments.map((d) => {
    const m = sumByDeployment.get(d.id)
    return {
      deploymentId: d.id,
      shortSlug: d.shortSlug,
      publishedAt: d.publishedAt,
      channel: {
        id: d.channel.id,
        name: d.channel.name,
        platform: d.channel.platform,
        kind: d.channel.kind,
      },
      metrics: {
        impressions: m?.impressions ?? 0,
        views: m?.views ?? 0,
        likes: m?.likes ?? 0,
        comments: m?.comments ?? 0,
        internalClicks: d._count.clickEvents,
        externalClicks: m?.externalClicks ?? 0,
      },
    }
  })

  // 6. 전체 합계 계산
  const total = byDeployment.reduce(
    (acc, d) => ({
      impressions: acc.impressions + d.metrics.impressions,
      views: acc.views + d.metrics.views,
      likes: acc.likes + d.metrics.likes,
      comments: acc.comments + d.metrics.comments,
      internalClicks: acc.internalClicks + d.metrics.internalClicks,
      externalClicks: acc.externalClicks + d.metrics.externalClicks,
    }),
    { impressions: 0, views: 0, likes: 0, comments: 0, internalClicks: 0, externalClicks: 0 }
  )

  // channelCount: 고유 channelId 수
  const channelCount = new Set(deployments.map((d) => d.channelId)).size

  return {
    total: { ...total, channelCount },
    daily,
    byDeployment,
  }
}

// ─── 콘텐츠 비교 ─────────────────────────────────────────────────────────────

/**
 * 2~5개 콘텐츠의 비교 데이터를 반환한다.
 * - contentIds 는 모두 동일한 spaceId 에 속해야 함 (권한 체크)
 * - 다른 space 의 id 가 포함되면 Error 를 throw
 * - daysBack: 최근 N일 (기본 30일)
 */
export async function getContentsCompareData(
  spaceId: string,
  contentIds: string[],
  daysBack = 30
): Promise<ContentCompareRow[]> {
  if (contentIds.length < 2 || contentIds.length > 5) {
    throw new Error(`contentIds 는 2~5개여야 합니다. (받은 값: ${contentIds.length})`)
  }

  // 1. 콘텐츠 fetch (spaceId 포함 where 절 — 다른 space 의 id 는 자동 제외)
  const contents = await prisma.content.findMany({
    where: { id: { in: contentIds }, spaceId },
    include: {
      deployments: {
        include: {
          channel: { select: { name: true, kind: true, platform: true } },
          _count: { select: { clickEvents: true } },
        },
      },
    },
  })

  // 권한 체크: 요청한 id 중 space 에 없는 것이 있으면 거부
  if (contents.length !== contentIds.length) {
    const foundIds = new Set(contents.map((c) => c.id))
    const missing = contentIds.filter((id) => !foundIds.has(id))
    throw new Error(`접근 권한이 없거나 존재하지 않는 콘텐츠 id: ${missing.join(', ')}`)
  }

  if (contents.length === 0) return []

  // 2. deployment ID → content ID 역매핑
  const deploymentToContent = new Map<string, string>()
  for (const c of contents) {
    for (const d of c.deployments) {
      deploymentToContent.set(d.id, c.id)
    }
  }
  const allDeploymentIds = [...deploymentToContent.keys()]

  // 3. 전체 합계용 groupBy (기간 무관)
  const metricSums = await prisma.deploymentMetric.groupBy({
    by: ['deploymentId'],
    where: { deploymentId: { in: allDeploymentIds } },
    _sum: {
      impressions: true,
      views: true,
      likes: true,
      comments: true,
      externalClicks: true,
    },
  })
  const sumByDeployment = new Map(metricSums.map((r) => [r.deploymentId, r._sum]))

  // 4. 일별 추이용 groupBy (daysBack 기간)
  const since = startOfDayUTC(new Date())
  since.setUTCDate(since.getUTCDate() - (daysBack - 1))

  const dailyRows = await prisma.deploymentMetric.groupBy({
    by: ['deploymentId', 'date'],
    where: {
      deploymentId: { in: allDeploymentIds },
      date: { gte: since },
    },
    _sum: {
      impressions: true,
      views: true,
      likes: true,
      comments: true,
      externalClicks: true,
    },
    orderBy: { date: 'asc' },
  })

  // contentId + date → 지표 합산 맵
  const contentDateMap = new Map<
    string,
    { impressions: number; views: number; likes: number; comments: number; externalClicks: number }
  >()
  for (const row of dailyRows) {
    const contentId = deploymentToContent.get(row.deploymentId)
    if (!contentId) continue
    const key = `${contentId}__${toISODate(row.date)}`
    const existing = contentDateMap.get(key) ?? {
      impressions: 0,
      views: 0,
      likes: 0,
      comments: 0,
      externalClicks: 0,
    }
    contentDateMap.set(key, {
      impressions: existing.impressions + (row._sum.impressions ?? 0),
      views: existing.views + (row._sum.views ?? 0),
      likes: existing.likes + (row._sum.likes ?? 0),
      comments: existing.comments + (row._sum.comments ?? 0),
      externalClicks: existing.externalClicks + (row._sum.externalClicks ?? 0),
    })
  }

  // 5. 통합 date spine (daysBack 일, 과거 → 현재 순)
  const dateSpine: string[] = []
  const today = startOfDayUTC(new Date())
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    dateSpine.push(toISODate(d))
  }

  // 6. 콘텐츠 단위 결과 조립
  return contents.map((c) => {
    // internalClicks: clickEvents 건수 합산
    const internalClicks = c.deployments.reduce((acc, d) => acc + d._count.clickEvents, 0)

    // 전체 합계
    const totalsRaw = c.deployments.reduce(
      (acc, d) => {
        const m = sumByDeployment.get(d.id)
        return {
          impressions: acc.impressions + (m?.impressions ?? 0),
          views: acc.views + (m?.views ?? 0),
          likes: acc.likes + (m?.likes ?? 0),
          comments: acc.comments + (m?.comments ?? 0),
          externalClicks: acc.externalClicks + (m?.externalClicks ?? 0),
        }
      },
      { impressions: 0, views: 0, likes: 0, comments: 0, externalClicks: 0 }
    )

    // 채널 목록 (중복 제거)
    const seenChannelNames = new Set<string>()
    const channels = c.deployments
      .filter(
        (d) => !seenChannelNames.has(d.channel.name) && (seenChannelNames.add(d.channel.name), true)
      )
      .map((d) => ({
        name: d.channel.name,
        kind: d.channel.kind,
        platform: d.channel.platform,
      }))

    // 일별 데이터 (spine 기준, 빈 날 0)
    const daily = dateSpine.map((date) => {
      const val = contentDateMap.get(`${c.id}__${date}`) ?? {
        impressions: 0,
        views: 0,
        likes: 0,
        comments: 0,
        externalClicks: 0,
      }
      return { date, ...val }
    })

    return {
      id: c.id,
      title: c.title,
      status: c.status,
      channels,
      totals: { ...totalsRaw, internalClicks },
      daily,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────

export interface MetricNumbers {
  impressions?: number | null
  views?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  externalClicks?: number | null
}

// 단일 (deploymentId, date, source) 행을 upsert.
export async function upsertDeploymentMetric(input: {
  spaceId: string
  deploymentId: string
  date: Date
  source: MetricSource
  numbers: MetricNumbers
}) {
  const date = startOfDayUTC(input.date)
  return prisma.deploymentMetric.upsert({
    where: {
      deploymentId_date_source: {
        deploymentId: input.deploymentId,
        date,
        source: input.source,
      },
    },
    create: {
      spaceId: input.spaceId,
      deploymentId: input.deploymentId,
      date,
      source: input.source,
      impressions: input.numbers.impressions ?? null,
      views: input.numbers.views ?? null,
      likes: input.numbers.likes ?? null,
      comments: input.numbers.comments ?? null,
      shares: input.numbers.shares ?? null,
      externalClicks: input.numbers.externalClicks ?? null,
    },
    update: {
      impressions: input.numbers.impressions ?? undefined,
      views: input.numbers.views ?? undefined,
      likes: input.numbers.likes ?? undefined,
      comments: input.numbers.comments ?? undefined,
      shares: input.numbers.shares ?? undefined,
      externalClicks: input.numbers.externalClicks ?? undefined,
    },
  })
}

export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// 배포 단위 누적 합. 같은 날짜에 여러 source 가 공존할 경우 이중 합산을 방지하기 위해
// pickDailyMetrics 로 날짜별 최우선 source 행만 채택한다 (MANUAL > BROWSER > API > INTERNAL).
// 반환 rows 는 원본 전체(호출처 디버깅용), total 은 dedup 된 집계.
//
// NOTE: getSpaceContentAnalytics / getContentMetricsTotal / getContentsCompareData 는
// DB 레벨 groupBy + _sum 으로 같은 이중합산 문제가 잠재. 해당 함수들은 source 컬럼을
// groupBy 키에 포함하지 않아 pickDailyMetrics 헬퍼를 직접 적용할 수 없으며,
// source 별 findMany 쿼리로 재작성하는 별도 개선이 필요하다.
export async function getDeploymentMetricsTotal(deploymentId: string) {
  const rows = await prisma.deploymentMetric.findMany({
    where: { deploymentId },
    orderBy: { date: 'desc' },
  })

  // 날짜별 단일 source 채택 후 합산 (이중 합산 방지)
  const deduped = pickDailyMetrics(rows)

  const total = deduped.reduce(
    (acc, r) => ({
      impressions: acc.impressions + (r.impressions ?? 0),
      views: acc.views + (r.views ?? 0),
      likes: acc.likes + (r.likes ?? 0),
      comments: acc.comments + (r.comments ?? 0),
      shares: acc.shares + (r.shares ?? 0),
      externalClicks: acc.externalClicks + (r.externalClicks ?? 0),
    }),
    { impressions: 0, views: 0, likes: 0, comments: 0, shares: 0, externalClicks: 0 }
  )

  return { rows, total }
}

// 스페이스 단위 요약 (클릭 수 포함).
export async function getSpaceAnalyticsSummary(spaceId: string) {
  const [deploymentCount, totalClicks, metricAgg] = await Promise.all([
    prisma.contentDeployment.count({ where: { spaceId } }),
    prisma.contentClickEvent.count({ where: { spaceId } }),
    prisma.deploymentMetric.aggregate({
      where: { spaceId },
      _sum: {
        impressions: true,
        views: true,
        likes: true,
        comments: true,
        shares: true,
        externalClicks: true,
      },
    }),
  ])

  return {
    deploymentCount,
    totalClicks,
    metrics: {
      impressions: metricAgg._sum.impressions ?? 0,
      views: metricAgg._sum.views ?? 0,
      likes: metricAgg._sum.likes ?? 0,
      comments: metricAgg._sum.comments ?? 0,
      shares: metricAgg._sum.shares ?? 0,
      externalClicks: metricAgg._sum.externalClicks ?? 0,
    },
  }
}

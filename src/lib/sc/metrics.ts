import { prisma } from '@/lib/prisma'
import type { MetricSource } from '@/generated/prisma/client'
// 타입 계약은 metrics-types.ts 에서 관리 (Bernstein 의 구현과 병렬 작업).
export type { SpaceContentAnalyticsRow, ContentMetricsTotal } from './metrics-types'
import type { SpaceContentAnalyticsRow, ContentMetricsTotal } from './metrics-types'

// ─── 구현 ─────────────────────────────────────────────────────────────────────

/**
 * 스페이스의 콘텐츠 단위 성과 데이터를 반환한다.
 * - 배포가 1개 이상 있는 콘텐츠만 포함 (최대 200건, 최신순)
 * - N+1 방지: DeploymentMetric 은 groupBy 로 한 번에 조회
 */
export async function getSpaceContentAnalytics(
  spaceId: string
): Promise<SpaceContentAnalyticsRow[]> {
  // 1. 배포가 있는 콘텐츠 fetch (channel 정보 + clickEvents 건수 포함)
  const contents = await prisma.content.findMany({
    where: {
      spaceId,
      deployments: { some: {} },
    },
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
  })

  if (contents.length === 0) return []

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

  // 3. 콘텐츠 단위 집계
  return contents.map((c) => {
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

    return {
      id: c.id,
      title: c.title,
      status: c.status,
      latestPublishedAt,
      channels,
      metrics: { ...metrics, internalClicks },
    }
  })
}

/**
 * 단일 콘텐츠의 합계 지표 + 배포별 분해를 반환한다.
 * - N+1 방지: DeploymentMetric 은 groupBy 로 한 번에 조회
 * - 배포가 0개면 빈 데이터 반환
 */
export async function getContentMetricsTotal(contentId: string): Promise<ContentMetricsTotal> {
  // 1. 콘텐츠의 모든 배포 fetch (channel 정보 + clickEvents 건수 포함)
  const deployments = await prisma.contentDeployment.findMany({
    where: { contentId },
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
      byDeployment: [],
    }
  }

  // 2. metrics groupBy 한 번에 조회
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

  // 3. 배포별 데이터 구성
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

  // 4. 전체 합계 계산
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
    byDeployment,
  }
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

// 배포 단위 누적 합 (source 무관). 가장 최근에 기록된 externalClicks 등을 선호하는 대신,
// 단순 합계로 시작한다. Unit 13 에서 분석 시 source 별 구분 필요 시 이 쪽을 세분화.
export async function getDeploymentMetricsTotal(deploymentId: string) {
  const rows = await prisma.deploymentMetric.findMany({
    where: { deploymentId },
    orderBy: { date: 'desc' },
  })

  const total = rows.reduce(
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

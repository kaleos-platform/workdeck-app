import { prisma } from '@/lib/prisma'
import type { MetricSource } from '@/generated/prisma/client'

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

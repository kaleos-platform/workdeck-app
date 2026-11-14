import { prisma } from '@/lib/prisma'
import { getDaysAgoStrKst, getTodayStrKst, parseYmdDateKst } from '@/lib/date-range'
import { countApplicationsByStatus } from './applications'

/** 모집 관리 홈 요약 — 모든 조회는 spaceId·deletedAt 으로 스코프하고 이름은 마스킹값만 읽는다. */
export async function getRecruitingHomeSummary(spaceId: string) {
  const weekAgoStr = getDaysAgoStrKst(7)
  const weekAgo = parseYmdDateKst(weekAgoStr) ?? undefined
  const [counts, weekCounts, postings, recent] = await Promise.all([
    countApplicationsByStatus(spaceId, {}),
    countApplicationsByStatus(spaceId, { from: weekAgo }),
    // 모집 중 = 발행(ACTIVE) + 마감일이 없거나 오늘(KST) 이후. isHiringDeadlinePassed 와 같은 기준.
    prisma.hiringPosting.findMany({
      where: {
        spaceId,
        status: 'ACTIVE',
        OR: [
          { closingDate: null },
          { closingDate: { gte: new Date(`${getTodayStrKst()}T00:00:00Z`) } },
        ],
      },
      orderBy: [{ closingDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
      take: 5,
      select: { id: true, uuid: true, title: true, closingDate: true },
    }),
    prisma.hiringApplication.findMany({
      where: { spaceId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        maskedName: true,
        stage: true,
        hiringStage: true,
        createdAt: true,
        posting: { select: { title: true } },
      },
    }),
  ])
  const inProgress =
    postings.length === 0
      ? []
      : await prisma.hiringApplication.groupBy({
          by: ['postingId'],
          where: {
            spaceId,
            deletedAt: null,
            stage: 'HIRING',
            postingId: { in: postings.map((p) => p.id) },
          },
          _count: true,
        })
  const inProgressByPosting = new Map(inProgress.map((g) => [g.postingId, g._count]))
  return {
    counts,
    weekCount: weekCounts.all,
    weekFrom: weekAgoStr,
    postings: postings.map((p) => ({ ...p, inProgress: inProgressByPosting.get(p.id) ?? 0 })),
    recent,
  }
}

/** 마감일(날짜값, UTC 자정 저장)까지 남은 일수 라벨. 오늘이면 D-day. */
export function formatDday(closingDate: Date | null): string | null {
  if (!closingDate) return null
  const today = new Date(`${getTodayStrKst()}T00:00:00Z`)
  const diff = Math.round((closingDate.getTime() - today.getTime()) / 86400000)
  return diff <= 0 ? 'D-day' : `D-${diff}`
}

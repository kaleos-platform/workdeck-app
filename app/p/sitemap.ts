import type { MetadataRoute } from 'next'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { buildAppUrl } from '@/lib/domain'
import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'

// 빌드 시 DB 를 읽지 않는다. 공개 공고 전용(마케팅 sitemap 과 분리).
export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000

// 마감일(UTC 자정 날짜값)의 KST 23:59:59 = 그날 UTC 14:59:59
const closingEnd = (closingDate: Date) =>
  new Date(closingDate.getTime() + 15 * 60 * 60 * 1000 - 1000)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const recent = new Date(now.getTime() - 30 * DAY)
  try {
    const postings = await prisma.hiringPosting.findMany({
      where: {
        space: { hiringCompanyProfile: { isNot: null } },
        closingDate: { not: null },
        publishedAt: { not: null },
        OR: [
          { status: 'ACTIVE', closingDate: { gte: new Date(recent.toISOString().slice(0, 10)) } },
          { status: 'CLOSED', updatedAt: { gte: recent } },
        ],
      },
      select: { uuid: true, closingDate: true, updatedAt: true },
      // ponytail: 50,000 = sitemap 프로토콜 한도, 넘으면 generateSitemaps 분할
      take: 50000,
      orderBy: { updatedAt: 'desc' },
    })
    const forceRecrawl = process.env.HIRING_JOBPOSTING === 'off'
    return postings.map((p) => {
      let lastModified = p.updatedAt
      if (isHiringDeadlinePassed(p.closingDate, now) && p.closingDate) {
        const end = closingEnd(p.closingDate)
        if (end > lastModified) lastModified = end
      }
      if (lastModified > now) lastModified = now
      return {
        url: buildAppUrl(`/p/${p.uuid}`),
        lastModified: forceRecrawl ? now : lastModified,
      }
    })
  } catch (error) {
    Sentry.captureException(error)
    return []
  }
}

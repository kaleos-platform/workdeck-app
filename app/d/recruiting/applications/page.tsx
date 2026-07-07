// 지원자 교차 목록(server component) — searchParams 로 필터·페이지네이션, 도메인 모듈 직접 조회.
import { resolveDeckContext } from '@/lib/api-helpers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { listApplications } from '@/lib/hiring/applications'
import type { HiringApplicationStage } from '@/generated/prisma/client'
import { ApplicationsTable } from '@/components/hiring-applicants/applications-table'

const PAGE_SIZE = 50
const VALID_STAGES = new Set(['HIRING', 'ACCEPTED', 'REJECTED'])

type Props = {
  searchParams: Promise<{
    posting?: string
    stage?: string
    from?: string
    to?: string
    page?: string
  }>
}

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export default async function ApplicationsPage({ searchParams }: Props) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const spaceId = resolved.space.id

  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const stage =
    sp.stage && VALID_STAGES.has(sp.stage) ? (sp.stage as HiringApplicationStage) : undefined
  const from = parseDate(sp.from)
  // to 는 해당 일자 끝까지 포함
  const toRaw = parseDate(sp.to)
  const to = toRaw ? new Date(toRaw.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined

  const [{ rows, total }, postings] = await Promise.all([
    listApplications(spaceId, {
      postingId: sp.posting || undefined,
      stage,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    }),
    prisma.hiringPosting.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true },
    }),
  ])

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">지원자 목록</h1>
        <p className="text-sm text-muted-foreground">
          전체 공고의 지원서를 한 곳에서 검토하고 단계를 관리합니다.
        </p>
      </div>

      <ApplicationsTable
        rows={rows}
        total={total}
        pageSize={PAGE_SIZE}
        page={page}
        postings={postings}
        filters={{
          posting: sp.posting ?? '',
          stage: sp.stage ?? '',
          from: sp.from ?? '',
          to: sp.to ?? '',
        }}
      />
    </div>
  )
}

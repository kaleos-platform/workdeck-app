import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { FeedbackTable } from '@/components/admin/feedback-table'
import { FEEDBACK_STATUSES, FEEDBACK_TYPES, storageCapBytes } from '@/lib/feedback/policy'
import type { UserFeedbackStatus } from '@/generated/prisma/enums'

const PAGE_SIZE = 50

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; page?: string }>
}) {
  const auth = await requireOperator()
  if (!auth.ok) notFound()

  const sp = await searchParams
  const type = FEEDBACK_TYPES.find((t) => t === sp.type)
  const status = FEEDBACK_STATUSES.find((s) => s === sp.status)
  const where = { type, status }
  const total = await prisma.userFeedback.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1))

  const [rows, grouped, live, ledger] = await Promise.all([
    prisma.userFeedback.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        type: true,
        status: true,
        body: true,
        user: { select: { email: true } },
        space: { select: { name: true } },
        _count: { select: { attachments: { where: { deletedAt: null } } } },
      },
    }),
    prisma.userFeedback.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.userFeedbackAttachment.aggregate({
      where: { deletedAt: null },
      _sum: { sizeBytes: true },
    }),
    prisma.feedbackFileDeletion.aggregate({ _sum: { bytes: true } }),
  ])
  const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<
    UserFeedbackStatus,
    number
  >
  for (const g of grouped) counts[g.status] = g._count._all

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">의견</h1>
        <p className="text-sm text-muted-foreground">이용자가 남긴 의견 (최신순, 50건씩)</p>
      </div>
      <FeedbackTable
        rows={rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          type: r.type,
          status: r.status,
          body: r.body.slice(0, 200),
          email: r.user.email,
          spaceName: r.space?.name ?? null,
          attachmentCount: r._count.attachments,
        }))}
        summary={{
          counts,
          totalBytes: (live._sum.sizeBytes ?? 0) + (ledger._sum.bytes ?? 0),
          capBytes: storageCapBytes(),
        }}
        type={type ?? ''}
        status={status ?? ''}
        page={page}
        pageCount={pageCount}
      />
    </div>
  )
}
